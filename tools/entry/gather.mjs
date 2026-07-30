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
import { intendedWindow, resolveSettings, resolveWindow } from "./settings-resolve.mjs";
import { parseWorktreeField } from "./worktree-field.mjs";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT = { number: 1, owner: "Pootytxng" };
export const REPO = "Pootytxng/sentinel";
export const CODE_ROOT = "C:\\Users\\Kuya\\code";
export const EXPECTED_COMMON_DIR = "C:\\Users\\Kuya\\code\\sentinel\\.git";

const gh = (args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

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
 * Everything `reconcile()` needs, measured.
 * @returns {{facts: object, target: {path, branch}|null, board: object}}
 */
export function gatherFacts({ issue, task, self = { lane: "Claude Code" }, now = new Date(), board = null, policy = null }) {
  const theBoard = board ?? readBoard();
  const theTask = task ?? theBoard.items.find((i) => Number(i.number) === Number(issue)) ?? null;

  const parsed = parseWorktreeField(theTask?.worktreeBranch ?? "", { codeRoot: CODE_ROOT });
  const target = parsed.ok ? (parsed.entries[0] ?? null) : null;

  const checkouts = discoverCheckouts({ roots: [CODE_ROOT] });
  const exists = target ? checkouts.some((c) => c.path.toLowerCase() === target.path.toLowerCase()) : false;
  const gitState = exists ? inspectGitState(target.path) : null;

  const thread = readIssueThread(theTask?.number ?? issue);
  const thePolicy = policy ?? loadPolicy();

  const settingsDir = exists ? target.path : HERE;
  const effective = resolveWindow({ dir: settingsDir, env: process.env });
  const resolved = resolveSettings({ dir: settingsDir, env: process.env });

  return {
    board: theBoard,
    target,
    facts: {
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
