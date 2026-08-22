#!/usr/bin/env node
// PreToolUse(Write|Edit|NotebookEdit) — refuse PROJECT writes from an unverified session (#125 step 3).
//
// Spec: docs/superpowers/specs/2026-08-21-unverified-session-write-refusal.md §3b.
//
// The SessionStart assert says one line and gets out of the way, which is right for a session that
// is only going to read. This is the other half: the moment an unverified session tries to change a
// file inside the project, it is stopped and told — in the same message — the one command that
// verifies it. The refusal and the cure ship together on purpose (§3a): a refusal with no
// self-service way back turns "open a window and do this" into "close the window and start over".
//
// FOUR PROPERTIES THIS FILE IS RESPONSIBLE FOR, all of them pinned in project-write-assert.test.mjs:
//
//   1. IT DOES NOT REIMPLEMENT IDENTITY. `verifySession` from the sibling assert is the only judge
//      of whether this session is verified. A second copy of those rules would be a copy that
//      drifts, and a drifted identity rule is precisely a wrong root passing for a right one.
//   2. IT ONLY GUARDS THE PROJECT. A write to the scratchpad, to %TEMP%, to anywhere outside the
//      resolved session root is not a project write and is never refused. The gate exists to stop
//      unverified changes to THIS repository, not to make an unverified session useless.
//   3. THE REFUSAL CARRIES A RUNNABLE CURE. `node tools/entry/cli.mjs adopt --issue <n> --session
//      <id>` with the id already filled in from the hook input, because a CLI run from Bash cannot
//      know which conversation it belongs to and guessing is how the wrong conversation adopts a
//      folder.
//   4. IT DISTINGUISHES "NEVER VERIFIED" FROM "DISAGREES". The advisory codes (#125 step 1's
//      UNVERIFIABLE + LAPSED split) mean nothing live contradicts this session — adoption is the
//      honest cure and it is offered. A STOP code means a live record actively disagrees about the
//      folder, branch, repo or conversation; adoption would refuse that too (ADOPT_FOLDER_CLAIMED),
//      so offering it would be advice that cannot work. Those get the assert's own reason instead.
//
// LAPSED IS REFUSED LIKE NO_TOKEN, deliberately. §2 of the spec measured a live lapsed token against
// the session actually doing the work: it disagreed on branch, session id AND issue, because the
// honest sessions are exactly the ones whose branch and issue legitimately moved on. So a lapsed
// record cannot re-verify itself, and it gets the same answer as never-launched — with one kindness:
// the issue is still on disk, so the cure is printed with that number already in it.
//
// IT NEVER PERSISTS. `verifySession({persist: false})`. This hook runs on every single write; it is
// a checkpoint, not the thing that establishes identity. SessionStart owns the record. (Persisting
// here would also delete the lapsed record whose issue number the refusal wants to offer.)
//
// FAILS OPEN on unreadable input or an unrecognized tool shape: a guard that stops work because it
// could not parse its own stdin is a worse outage than the one it prevents. It fails CLOSED on the
// thing it is for — an identifiable project write from a session that is not verified.
//
// This file is NOT self-contained and does not need to be: tracked-hooks.test.mjs applies that rule
// to session-root-assert.mjs alone (it is copied on its own into folders that predate tools/entry).
// The import here is a sibling in the same directory, so it survives any copy that brings the hooks.

import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import {
  CORRUPT,
  LAPSED_CODES,
  TOKEN_DIR,
  UNVERIFIABLE_CODES,
  canonicalizePath,
  readLineage,
  readToken,
  resolveSessionRoot,
  samePath,
  verifySession,
} from "./session-root-assert.mjs";

/** The tools that change a file directly. `Bash` is the named hole — spec §3c, not an oversight. */
export const GUARDED_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);

/** Every field these tools use to name their target. NotebookEdit differs; the rest agree. */
export const PATH_FIELDS = ["file_path", "notebook_path"];

/** @returns {string|null} the path this call would write, or null if the shape is unfamiliar. */
export function targetOf(toolInput) {
  for (const field of PATH_FIELDS) {
    const value = toolInput?.[field];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return null;
}

/**
 * Is `target` the root itself or anything beneath it? Relative paths resolve against the session
 * cwd first, and `..` is collapsed before the comparison — otherwise `../other-repo/x` reads as a
 * path that starts with the root and is refused for a write that never touches this project.
 */
export function isInsideRoot(target, root, { cwd = null } = {}) {
  if (!target || !root) return false;
  const abs = isAbsolute(target) ? target : resolve(cwd || process.cwd(), target);
  const a = canonicalizePath(abs).toLowerCase();
  const r = canonicalizePath(root).toLowerCase();
  if (!r) return false;
  return samePath(abs, root) || a.startsWith(`${r}\\`);
}

/** The cure, with the conversation id already in it. `<id>` only when the harness sent none. */
export function adoptCommand({ sessionId, issue = null }) {
  const issuePart = Number.isInteger(Number(issue)) && Number(issue) > 0 ? String(Number(issue)) : "<n>";
  return `node tools/entry/cli.mjs adopt --issue ${issuePart} --session ${sessionId || "<id>"}`;
}

const HEADER = "Blocked: this session is not verified for this folder, and this is a project write.";

/**
 * The whole decision, with every fact injected — no disk, no stdin. The shell below gathers.
 *
 * @param {object} f
 * @param {string} f.toolName
 * @param {object} f.toolInput
 * @param {object} f.verdict        whatever `verifySession` returned
 * @param {string} f.root           the resolved session root
 * @param {string|null} f.sessionId from the hook input
 * @param {string|null} f.cwd       the session cwd, for resolving a relative target
 * @param {number|null} f.knownIssue an issue number still on disk, for a LAPSED cure
 * @returns {{allow: boolean, reason?: string, code?: string, target?: string}}
 */
export function decide({ toolName, toolInput, verdict, root, sessionId = null, cwd = null, knownIssue = null }) {
  if (!GUARDED_TOOLS.has(String(toolName ?? ""))) return { allow: true, why: "not a write tool" };

  const target = targetOf(toolInput);
  if (!target) return { allow: true, why: "no target path in the tool input" };
  if (!isInsideRoot(target, root, { cwd })) return { allow: true, why: "outside the project root", target };
  if (verdict?.ok) return { allow: true, why: `verified (${verdict.mode})`, target };

  const code = verdict?.code ?? "UNKNOWN";
  const cure = adoptCommand({ sessionId, issue: knownIssue });

  if (UNVERIFIABLE_CODES.has(code)) {
    return {
      allow: false,
      code,
      target,
      reason:
        `${HEADER}\n\n` +
        `Nothing on disk ever verified that ${root} is the folder, branch and claim this ` +
        `conversation is working under (${code}), so a write here is a change nobody can attribute.\n\n` +
        `Verify this session without restarting it — run this in Bash, with the issue you are ` +
        `actually working:\n\n    ${cure}\n\n` +
        `That binds folder + branch + session + issue exactly as a launch does; it reads the branch ` +
        `and never sets it. Then retry the write. If the work genuinely belongs outside this ` +
        `repository, write it outside the repository — paths outside ${root} are not guarded.`,
    };
  }

  if (LAPSED_CODES.has(code)) {
    return {
      allow: false,
      code,
      target,
      reason:
        `${HEADER}\n\n` +
        `A launch WAS made for this folder and its clock ran out (${code}). That record cannot ` +
        `re-verify this session: the branch, the issue and the conversation id all move on during ` +
        `honest work, so "still matches" would only pass sessions that changed nothing.\n\n` +
        `Verify this session without restarting it — run this in Bash` +
        (knownIssue ? ` (the issue is the one already on disk; change it if the work moved on)` : "") +
        `:\n\n    ${cure}\n\n` +
        `Then retry the write.`,
    };
  }

  // A live record actively disagrees. Adoption is not the cure here and would refuse too, so the
  // message is the assert's own — the fix is to make the disagreement go away, not to write past it.
  return {
    allow: false,
    code,
    target,
    reason:
      `Blocked: ${code} — a live launch record disagrees with this session, and this is a project write.\n\n` +
      `${verdict?.reason ?? "No reason was recorded."}\n\n` +
      `This is not an unverified session; it is a contradicted one, so adopting would be refused as ` +
      `well. Resolve the disagreement (reopen the right folder, or relaunch through the entrypoint) ` +
      `before changing ${target}.`,
  };
}

/** An issue number still readable on disk, for a LAPSED cure. Never invented, never from CORRUPT. */
export function knownIssueFor({ root, dir = TOKEN_DIR, verdict = null, read = readLineage, token = readToken } = {}) {
  if (Number.isInteger(verdict?.issue)) return verdict.issue;
  try {
    const lineage = root ? read({ root, dir }) : null;
    if (lineage && lineage !== CORRUPT && Number.isInteger(lineage.issue)) return lineage.issue;
    const t = token({ dir });
    if (t && t !== CORRUPT && Number.isInteger(t.issue)) return t.issue;
  } catch {
    /* an unreadable record means no suggestion, never a wrong one */
  }
  return null;
}

/** The IO shell: read stdin, ask the one judge, decide. Injectable end to end for the guards. */
export function run({
  hookInput,
  dir = TOKEN_DIR,
  env = process.env,
  now = new Date(),
  verify = verifySession,
  issueLookup = knownIssueFor,
} = {}) {
  const cwd = hookInput?.cwd ?? null;
  const resolved = resolveSessionRoot({ env, hookInput, cwd: cwd ?? process.cwd() });
  const verdict = verify({ dir, env, hookInput, cwd: cwd ?? process.cwd(), now, persist: false });
  return decide({
    toolName: hookInput?.tool_name,
    toolInput: hookInput?.tool_input,
    verdict,
    root: resolved.root,
    sessionId: hookInput?.session_id ?? null,
    cwd,
    knownIssue: verdict?.ok ? null : issueLookup({ root: resolved.root, dir, verdict }),
  });
}

/** The deny wire format PreToolUse understands. An allow says nothing at all. */
export function emit(decision, { write = (s) => process.stdout.write(s) } = {}) {
  if (decision.allow) return 0;
  write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: decision.reason,
      },
    })}\n`,
  );
  return 0;
}

const invokedDirectly = (() => {
  try {
    return Boolean(process.argv[1]) && resolve(process.argv[1]).toLowerCase().endsWith("project-write-assert.mjs");
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  let input = null;
  try {
    input = JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    process.exit(0); // unreadable stdin is this hook's problem, not the session's
  }
  try {
    process.exit(emit(run({ hookInput: input })));
  } catch {
    process.exit(0); // fail open on anything unexpected; the SessionStart line still fired
  }
}
