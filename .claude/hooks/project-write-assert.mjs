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
//   2. IT GUARDS BY TARGET, NOT BY DISTANCE FROM THE ROOT (#278, revised). A write to the
//      scratchpad, to %TEMP%, to an unrelated project is not a project write and is never refused.
//      But "outside the session root" used to mean "outside protection", and it does not: a SIBLING
//      worktree of this repository is another lane's checkout, and `~/.claude` is the owner's
//      configuration. Both were allowed by the same line. `target-ownership.mjs` answers where a
//      path lives; this file only decides what to do about it.
//   3. THE ANSWER CARRIES ITS CURE. An advisory outcome proceeds with one line of
//      `additionalContext` naming the real cure (an Ownership claim on the issue, which the push
//      gate enforces); a refusal carries the assert's own reason. Nothing here is a closed window.
//   4. IT DISTINGUISHES "NEVER VERIFIED" FROM "DISAGREES". The advisory codes (#125 step 1's
//      UNVERIFIABLE + LAPSED split) mean nothing live contradicts this session, and since the
//      2026-09-03 ruling (#368, spec §8/§9) they PROCEED: `permissionDecision: "allow"` plus the
//      cure as `additionalContext`. A STOP code means a live record actively disagrees about the
//      folder, branch, repo or conversation; that stays `deny` with the assert's own reason.
//
// WHY ALLOW + CONTEXT, NOT ASK. Every desktop-app session starts in an unclaimed worktree, and the
// owner ruled "never again" to writes refused there. §8 first specified `ask` on the premise that
// `permissions.defaultMode: "auto"` would route it to allow; that premise is false — a hook `ask`
// is a real prompt in every mode (code.claude.com/docs/en/hooks), so it would have prompted on
// EVERY write. The ruling's intent ("an unclaimed session proceeds") is therefore implemented as
// allow, with the cure delivered as context instead of a wall. LAPSED (BOARD_UNREACHABLE, the one
// lapsed code since #216) is treated the same way: the fact that would answer "what is this folder
// for" could not be read this time, and the folder's issue number is named in the line when a
// previous read left one on disk.
//
// IT NEVER PERSISTS. `verifySession({persist: false})`. This hook runs on every single write; it is
// a checkpoint, not the thing that establishes identity. SessionStart owns the record. (Persisting
// here would also delete the lapsed record whose issue number the refusal wants to offer.)
//
// FAILS OPEN on unreadable input or an unrecognized tool shape: a guard that stops work because it
// could not parse its own stdin is a worse outage than the one it prevents. It fails CLOSED on the
// thing it is for — an identifiable project write from a session a live record contradicts, or
// into a checkout this session does not own.
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
import { ZONES, zoneOf } from "./target-ownership.mjs";

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

/**
 * The adopt line, with the conversation id already in it. `<id>` only when the harness sent none.
 * No longer printed by `decide` (#368: the advisory codes proceed, and `adopt` writes a local record
 * the board check never reads); kept as the one formatter for that line so nothing re-derives it.
 */
export function adoptCommand({ sessionId, issue = null }) {
  const issuePart = Number.isInteger(Number(issue)) && Number(issue) > 0 ? String(Number(issue)) : "<n>";
  return `node tools/entry/cli.mjs adopt --issue ${issuePart} --session ${sessionId || "<id>"}`;
}

/**
 * The one line an advisory outcome carries into the model's context (#368). It names the cure the
 * push gate actually enforces — an Ownership claim on the issue — and the issue itself when a
 * previous read left its number on disk. One line, because it rides along on every write.
 */
export function advisoryContext({ code, knownIssue = null }) {
  const what = UNVERIFIABLE_CODES.has(code)
    ? "this folder has no Work Control claim"
    : "Work Control could not be read, so this folder's claim is unverified";
  const issue = Number.isInteger(Number(knownIssue)) && Number(knownIssue) > 0 ? `#${Number(knownIssue)}` : "the issue";
  return `compy-entry: ${code} - ${what}; writes proceed, but post an Ownership claim on ${issue} before pushing (the push gate enforces it).`;
}

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
 * @param {number|null} f.knownIssue an issue number still on disk, named in the advisory line
 * @returns {{allow: boolean, permission?: "allow"|"deny"|"ask", reason?: string, additionalContext?: string, code?: string, target?: string}}
 */
export function decide({ toolName, toolInput, verdict, root, sessionId = null, cwd = null, knownIssue = null, zone = zoneOf }) {
  if (!GUARDED_TOOLS.has(String(toolName ?? ""))) return { allow: true, why: "not a write tool" };

  const target = targetOf(toolInput);
  if (!target) return { allow: true, why: "no target path in the tool input" };

  // Outside the root is where the second hole was (#278). Ask which zone the target is in rather
  // than reading distance-from-root as safety.
  if (!isInsideRoot(target, root, { cwd })) {
    const z = zone({ target, sessionRoot: root, cwd });
    if (z.zone === ZONES.SIBLING) {
      return {
        allow: false,
        permission: "deny",
        code: "TARGET_NOT_OURS",
        target,
        reason:
          `Blocked: ${z.abs} belongs to ${z.owner} — ${z.why} — and this session is working in ` +
          `${root}. A claim covers one checkout, so another lane's files are not this lane's to ` +
          `write, verified or not.\n\nMake the change in a session opened on ${z.owner}, or in ` +
          `this one against a path it owns. Reaching it through the shell is refused for the same ` +
          `reason, so switching tools is not the way round it.`,
      };
    }
    if (z.zone === ZONES.GLOBAL) {
      return {
        allow: false,
        permission: "ask",
        code: "TARGET_OWNER_CONFIG",
        target,
        reason:
          `${z.abs} is inside the owner's global configuration (${z.owner}). It sits outside every ` +
          `repository guard and no repo claim covers it, so this exact operation and target need ` +
          `explicit approval rather than inheriting this lane's claim.`,
      };
    }
    if (z.zone === ZONES.UNKNOWN) {
      return {
        allow: false,
        permission: "ask",
        code: "TARGET_UNRESOLVED",
        target,
        reason:
          `Where ${target} lands could not be worked out (${z.why}). An unresolved path is not ` +
          `evidence that it is outside protection, so it takes the normal approval path instead of ` +
          `being treated as outside by default.`,
      };
    }
    return { allow: true, why: "outside the project root", target };
  }

  if (verdict?.ok) return { allow: true, why: `verified (${verdict.mode})`, target };

  const code = verdict?.code ?? "UNKNOWN";

  // The advisory codes raise NO OBJECTION (#368, spec sections 8/9). Nothing live contradicts this
  // session; the folder is merely unclaimed, or the board could not be read this time. Every
  // stricter check (sibling, global config, unresolved target) has already run above, exactly as
  // for a verified session. This hook makes no decision - `emit` writes the context ALONE, so the
  // settings rules and the auto-mode classifier still apply - and the model is told, in one line,
  // what the push gate will require of it.
  if (UNVERIFIABLE_CODES.has(code) || LAPSED_CODES.has(code)) {
    return {
      allow: true,
      code,
      target,
      why: `advisory (${code}): no objection; the write proceeds with its cure as context`,
      additionalContext: advisoryContext({ code, knownIssue }),
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
  zone = zoneOf,
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
    zone,
  });
}

/**
 * The wire format PreToolUse understands. `allow: true` means this hook raises NO OBJECTION and is
 * never written as a decision: a plain one says nothing at all, and one that carries
 * `additionalContext` (#368, the advisory codes) is written as that context ALONE - no
 * `permissionDecision` - which the hooks reference defines as "no decision; the normal permission
 * flow still applies", with the context delivered to the model. (`permissionDecision: "allow"`
 * would skip the interactive prompt and the auto-mode classifier for the call - broader than an
 * advisory means.)
 *
 * `ask` joins `deny` here (#278). A hook `ask` is a REAL PROMPT in every permission mode, including
 * `permissions.defaultMode: "auto"`, and a hook decision overrides `permissions.allow` rules
 * (code.claude.com/docs/en/permission-modes, /hooks); it never degrades to allow. That is exactly why
 * it is reserved for the genuinely unresolvable, and a resolved violation still gets `deny`.
 */
export function emit(decision, { write = (s) => process.stdout.write(s) } = {}) {
  if (decision.allow) {
    if (typeof decision.additionalContext !== "string" || decision.additionalContext === "") return 0;
    // Context ALONE: no `permissionDecision` key, so this is "no decision" to the harness.
    write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: decision.additionalContext } })}\n`);
    return 0;
  }
  write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision.permission ?? "deny",
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
