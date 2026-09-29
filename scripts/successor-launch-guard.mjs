// successor-launch-guard — #632: a successor prompt launches only as successor-route.mjs prints it.
//
// WHY THIS EXISTS. On 2026-09-29 two chains launched ten successor sessions: "Land #620 … after #611
// merges" six times and "Land #616 once #583 releases history.rs" four times. Each one rechecked a gate
// that had not moved and re-spawned its own prompt. None went through successor-route.mjs. The prompts
// were hand-written, or copies of the preamble from before #626 re-sent by hand, so no check ever read
// them. This is the PreToolUse check for the two launch tools: a prompt that claims to be a successor
// handoff launches only if it is exactly the router's output for a Handoff the router accepts today.
// Every other prompt (an ordinary chip, the idle launcher routine) passes untouched.
//
// A routine run carries only its taskId, so the prompt judged is the routine's stored SKILL.md body.
// An unreadable one is allowed: the routine cannot run a prompt that nobody can read either.
//
// The hook that calls this, `.claude/hooks/successor-launch-guard.mjs`, and its registration are
// owner-applied: `docs/superpowers/specs/2026-09-29-successor-launch-guard-632.patch`.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseClaim, parseHandoff } from "../tools/entry/claim.mjs";
import { RESPAWN, SUCCESSOR_PREAMBLE, readScheduledTasks, successorPrompt, withoutMentions } from "./successor-route.mjs";

export const SPAWN_TOOL = "mcp__ccd_session__spawn_task";
export const ROUTINE_TOOL = "mcp__scheduled-tasks__run_scheduled_task";

// Every preamble version opens with this sentence. The idle launcher routine says "Launcher routine
// for Compy successor sessions", which is not a claim to be one.
const MARKER = "You are a Compy successor session";
// The #616 chain had no preamble and no Handoff; it said "Write `Successor: chip` with this same prompt".
// The loop wording is the router's own RESPAWN, and all three are read through the router's mention
// rule, so the guard and the router cannot drift apart: a chip that only talks about "this same
// prompt", or names a loop phrase, the marker or a Successor line as what a doc or test is about,
// launches nothing.
const SUCCESSOR_LINE = /\bSuccessor:\s*`?\s*(?:chip|launched)\b/i;

/** Does this prompt claim to be a successor handoff? */
export function isSuccessorPrompt(text) {
  const said = withoutMentions(text);
  return (
    said.includes(MARKER) ||
    parseHandoff(text) !== null ||
    parseClaim(text) !== null ||
    SUCCESSOR_LINE.test(said) ||
    RESPAWN.test(said)
  );
}

/**
 * @param {unknown} prompt - the text a launch would start a session with
 * @returns {{allow: true} | {allow: false, why: string}}
 */
export function judgePrompt(prompt) {
  if (typeof prompt !== "string") return { allow: true };
  const text = prompt.replace(/\r\n?/g, "\n").trimStart();
  if (!isSuccessorPrompt(text)) return { allow: true };
  const head = `${SUCCESSOR_PREAMBLE}\n`;
  if (!text.startsWith(head)) {
    return {
      allow: false,
      why: "it does not start with today's successor preamble, so it is not what the router printed: a hand-written prompt or an old copy is never checked",
    };
  }
  const routed = successorPrompt(text.slice(head.length));
  return routed.ok ? { allow: true } : { allow: false, why: routed.why };
}

/**
 * The prompt a routine run would start with: its stored SKILL.md, frontmatter removed. The store's
 * `filePath` wins; `~/.claude/scheduled-tasks/<id>/SKILL.md` is where the app wrote every one seen.
 * @returns {string|null} null when the id is malformed or the file cannot be read
 */
export function routinePrompt(taskId, { root, home = homedir() } = {}) {
  if (typeof taskId !== "string" || !/^[A-Za-z0-9_-]+$/.test(taskId)) return null;
  const stored = readScheduledTasks(root === undefined ? {} : { root }).find(
    (task) => task?.id === taskId && typeof task.filePath === "string",
  );
  const file = stored?.filePath ?? join(home, ".claude", "scheduled-tasks", taskId, "SKILL.md");
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  // trimStart also drops a BOM (U+FEFF is whitespace to JS).
  return text.replace(/\r\n?/g, "\n").trimStart().replace(/^---\n[\s\S]*?\n---\n/, "");
}

/**
 * The PreToolUse hook's answer for one tool call.
 * @param {string} stdinText - the hook event JSON
 * @param {{root?: string, home?: string}} [opts] - where routines are stored (tests)
 * @returns {object|null} a deny decision, or null to let the call through
 */
export function hookOutput(stdinText, opts = {}) {
  let event;
  try {
    event = JSON.parse(stdinText);
  } catch {
    return null; // fail open: a malformed event is not a successor launch
  }
  const input = event?.tool_input ?? {};
  let prompt;
  if (event?.tool_name === SPAWN_TOOL) prompt = input.prompt;
  else if (event?.tool_name === ROUTINE_TOOL) prompt = routinePrompt(input.taskId, opts);
  else return null;
  const verdict = judgePrompt(prompt);
  if (verdict.allow) return null;
  const tail = verdict.why.includes("Successor: none")
    ? ""
    : " Launch a successor only as `node scripts/successor-route.mjs --handoff <file>` prints it, passed verbatim; if the work is blocked, owner-gated, complete or only a recheck, launch nothing: post its status on the issue and end with `Successor: none — <why>`.";
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `Successor launch refused (#632): ${verdict.why}.${tail}`,
    },
  };
}
