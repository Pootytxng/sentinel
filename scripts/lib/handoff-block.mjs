// Detector for the HANDOFF BLOCK law (CLAUDE.md -> "Reports, subagents, self-review").
//
// WHY THIS IS CODE AND NOT PROSE. "End every session with a HANDOFF BLOCK" has been written in
// CLAUDE.md for months and the owner has had to ask for it by hand more than once — most recently
// on 2026-08-11, in his words "ive already mentioned this multiple times now". Under the standing
// toolchain-over-prose law, a rule that keeps getting missed is not restated, it is enforced. The
// hook that enforces it (.claude/hooks/handoff-block-guard.mjs) cannot be unit-tested, because it
// needs a live transcript and a Stop event; this pure function can be, so the judgement lives here
// and the hook is only plumbing.
//
// WHAT THE OWNER ACTUALLY NEEDED, and what this file checked from 2026-08-11 to 2026-09-17 (history,
// not the current contract — see the UPDATE below):
//   1. A TAB VERDICT — may he close this VS Code tab, or must he keep it open and why? He keeps no
//      notes, so a session whose fate is unstated stays in his sidebar forever and buries the live
//      work.
//   2. A NEXT ACTION — what the next session should do, specifically enough to paste and start.
//   3. A LANE — does that next action continue THIS lane, or start a different one? Without it he
//      cannot tell whether the handoff describes the work he was just watching or something else.
// All three, or it did not count. A cheerful "all done!" with no verdict was exactly the failure.
//
// WHY THE VOCABULARY CHANGED (owner, 2026-08-20). It used to demand "archive / delete / leave open".
// In his words: that wording never said "what it literally means or how im supposed to know when to
// actually close the tab in vscode". "Leave open" described the model's state, not an instruction he
// could act on, so it is no longer accepted — the block must name the tab and the lane.
//
// UPDATE (2026-09-17/18, #466). The owner's next order: stop pasting a paste-ready prompt for HIM to
// carry into a new tab — launch the next session yourself. NEXT_ACTION and LANE are gone; a paste-
// ready prompt for a human to relay is exactly the manual step being removed. In their place, a
// single `Successor: launched|chip|none — <reason>` line names what already happened this turn:
// "launched" (a compy-successor scheduled-task routine was dispatched), "chip" (a one-click
// spawn_task chip was queued), or "none" (neither applied, with why — e.g. nothing left to hand off,
// or no launcher is armed on this machine yet). TAB VERDICT is unchanged; it is still his to read.
//
// A stated "launched"/"chip" is a CLAIM, and #270's lesson (a label with a hollow answer is the same
// non-verdict in a different coat) applies just as much to a false claim as to an empty one — so
// turnLaunches()/checkSuccessorProof() below check the claim against the turn's OWN tool calls,
// rather than trusting the sentence. scripts/successor-route.mjs (#466) is the thing that is
// supposed to have been called to produce that claim in the first place.

// Matched against a whitespace-collapsed, lowercased copy: re-wrapping a block must never change
// the verdict, and neither must capitalisation.
const flatten = (text) => String(text ?? "").replace(/\s+/g, " ").toLowerCase();

// The tab verdict. Deliberately narrow, and deliberately about the TAB rather than the "session":
// he acts on a window in front of him, not on the model's internal state. Keeping it open is only a
// verdict when it carries a reason, so the "keep" arm requires because/until/so/while after it.
const TAB_VERDICT =
  /\b(safe to close|done with this tab|(you can |ok to )?close (this|the) tab|keep (this|the) tab open (because|until|so|while)\b)/;

// A LABELLED successor line, answered in the writer's own words after a closed-vocabulary kind word.
// Unlike the retired LANE_LABEL, the kind must be one of three literal states — a hollow or
// mislabelled line (e.g. "Successor:\nNext session: ...") simply fails to match at all, because
// "next session" is not one of them, so it needs no separate NEXT_FIELD cutoff to stay unanswered.
const SUCCESSOR_LABEL =
  /(?:^|[\s*_>|-])successor\**\s*:\s*\**\s*(launched|chip|none)\**\s*[—–:-]\s*\**\s*([^\n.;|]{0,200})/gi;

// THE LABEL ALONE IS NOT ENOUGH — the 2026-08-20 "leave session open" lesson applied to this half
// too: naming a field and leaving it hollow is the same non-verdict in a different coat. An answer
// is two or more words, and is not one of the stock evasions.
const NON_ANSWER = /^(n\/?a|tbd|todo|none|unknown|unclear|see above|same|\?+|-+|_+)$/;

/**
 * The LAST `Successor:` line wins — a later line corrects an earlier one in the same reply, the way
 * a model revising its own draft would expect. `.match()` without /g only ever returns the FIRST
 * hit, so this walks every match by hand rather than reusing that shortcut.
 * @param {string} flat - flattened (whitespace-collapsed, lowercased) text
 * @returns {{kind: "launched"|"chip"|"none", detail: string}|null}
 */
function parseSuccessor(flat) {
  SUCCESSOR_LABEL.lastIndex = 0;
  let match;
  let last = null;
  while ((match = SUCCESSOR_LABEL.exec(flat)) !== null) {
    last = match;
    if (match.index === SUCCESSOR_LABEL.lastIndex) SUCCESSOR_LABEL.lastIndex++; // guard a zero-width match
  }
  if (!last) return null;
  const detail = (last[2] || "").trim();
  if (!detail || NON_ANSWER.test(detail)) return null;
  if (detail.split(/\s+/).filter(Boolean).length < 2) return null;
  return { kind: last[1], detail };
}

/**
 * Does this assistant message carry a usable handoff: a tab verdict, and a Successor line that
 * parses? This checks the TEXT only — whether a "launched"/"chip" claim is actually TRUE is a
 * separate question, answered by turnLaunches()/checkSuccessorProof() against the transcript.
 * @param {string} text - the final assistant message of a turn
 * @returns {{ ok: boolean, missing: string[], successor: {kind: string, detail: string}|null }}
 *   missing names the halves that are absent, using exactly "tab verdict" / "successor line".
 */
export function checkHandoffBlock(text) {
  const flat = flatten(text);
  const missing = [];
  if (!TAB_VERDICT.test(flat)) missing.push("tab verdict");
  const successor = parseSuccessor(flat);
  if (!successor) missing.push("successor line");
  return { ok: missing.length === 0, missing, successor };
}

// ── proving a "launched"/"chip" claim against what the turn actually did ─────────────────────────

// Matched by SUFFIX: the server-id segment of an MCP tool name (mcp__<server>__<tool>) is not
// something a hook can predict. success:null means "any non-error result counts" —
// start_session/hand_off_to_session are gated off for this account today, so there is no success
// text yet to measure against; run_scheduled_task/spawn_task have a measured success phrasing.
const LAUNCH_TOOLS = [
  { pattern: /__run_scheduled_task$/, kind: "launched", success: /dispatched\s+as\s+session/i },
  { pattern: /__spawn_task$/, kind: "chip", success: /task_id/i },
  { pattern: /__start_session$/, kind: "launched", success: null },
  { pattern: /__hand_off_to_session$/, kind: "launched", success: null },
];

function resultText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => c?.type === "text" && typeof c.text === "string")
      .map((c) => c.text)
      .join("\n");
  }
  return "";
}

// A real owner chat turn, as distinct from everything else shaped like `type: "user"`: a tool
// result (content is an array of tool_result blocks), Stop-hook feedback or other isMeta note, and a
// compaction's isCompactSummary entry. Sidechain entries are a subagent's transcript, not his.
//
// Belt and braces (#466 review): isMeta is how the harness USUALLY marks a re-injected Stop-hook
// reason, but that is not guaranteed on every path, so a "Stop hook feedback:" content prefix is
// checked directly too. Without this, a hook-triggered continuation can be mistaken for a fresh owner
// turn, the scan boundary lands too late, and a launch made earlier in the same turn goes uncounted.
const STOP_HOOK_FEEDBACK_PREFIX = "stop hook feedback:";

function isGenuineOwnerMessage(entry) {
  if (entry?.type !== "user") return false;
  if (entry?.isSidechain === true || entry?.isMeta === true || entry?.isCompactSummary === true) return false;
  const content = entry?.message?.content;
  let text = null;
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content) && content.length > 0 && content.every((c) => c?.type === "text")) {
    text = content.map((c) => (typeof c?.text === "string" ? c.text : "")).join("\n");
  } else {
    return false;
  }
  if (text.trimStart().toLowerCase().startsWith(STOP_HOOK_FEEDBACK_PREFIX)) return false;
  return true;
}

/**
 * How many successor-launching tool calls happened since the owner's LAST real message — the proof
 * behind a `Successor: launched`/`chip` claim. A call from before that message is a prior turn's
 * work and cannot back THIS turn's claim.
 * @param {string} tail - raw JSONL transcript tail; tolerates a truncated leading line
 * @returns {{launched: number, chip: number}}
 */
export function turnLaunches(tail) {
  const entries = [];
  for (const raw of String(tail ?? "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      continue; // partial or non-JSON line
    }
  }

  let boundary = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (isGenuineOwnerMessage(entries[i])) {
      boundary = i;
      break;
    }
  }

  const resultsById = new Map();
  for (let i = boundary + 1; i < entries.length; i++) {
    const entry = entries[i];
    if (entry?.isSidechain === true || entry?.type !== "user") continue;
    const content = entry?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === "tool_result" && block.tool_use_id) {
        resultsById.set(block.tool_use_id, { text: resultText(block.content), isError: block.is_error === true });
      }
    }
  }

  const counts = { launched: 0, chip: 0 };
  for (let i = boundary + 1; i < entries.length; i++) {
    const entry = entries[i];
    if (entry?.isSidechain === true || entry?.type !== "assistant") continue;
    const content = entry?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type !== "tool_use" || typeof block.name !== "string") continue;
      const tool = LAUNCH_TOOLS.find((t) => t.pattern.test(block.name));
      if (!tool) continue;
      const result = resultsById.get(block.id);
      if (!result || result.isError) continue;
      if (tool.success && !tool.success.test(result.text)) continue;
      counts[tool.kind]++;
    }
  }
  return counts;
}

/**
 * Is a parsed successor claim backed by what the turn actually did? "none" and a null successor
 * (the text half already failed, and asking for proof of an unparsed claim is a confusing ask)
 * always pass — there is nothing to prove yet.
 * @param {{kind: string, detail: string}|null} successor - parseSuccessor()'s result
 * @param {{launched: number, chip: number}} launches - turnLaunches()'s result
 * @returns {{ ok: boolean, missing: string[] }} missing is exactly "launched proof" / "chip proof"
 */
export function checkSuccessorProof(successor, launches) {
  const l = launches && typeof launches === "object" ? launches : { launched: 0, chip: 0 };
  if (successor?.kind === "launched" && !(Number(l.launched) > 0)) return { ok: false, missing: ["launched proof"] };
  if (successor?.kind === "chip" && !(Number(l.chip) > 0)) return { ok: false, missing: ["chip proof"] };
  return { ok: true, missing: [] };
}

/**
 * Pull the text of the last non-sidechain assistant message out of a transcript tail.
 * Tolerates a truncated first line (the tail is read from a byte offset, not a line boundary).
 * @param {string} tail - raw JSONL text
 * @returns {string|null} the message text, or null if none could be read
 */
export function lastAssistantText(tail) {
  const lines = String(tail ?? "").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // partial or non-JSON line
    }
    if (entry?.isSidechain === true) continue;
    if (entry?.type !== "assistant") continue;
    const content = entry?.message?.content;
    if (!Array.isArray(content)) continue;
    const text = content
      .filter((c) => c?.type === "text" && typeof c.text === "string")
      .map((c) => c.text)
      .join("\n");
    // A turn that ended in tool calls has no text block; keep walking back rather than treating
    // an empty string as "the model said nothing about a handoff".
    if (text.trim()) return text;
  }
  return null;
}
