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
// WHAT THE OWNER ACTUALLY NEEDS, and therefore what counts as a pass:
//   1. A TAB VERDICT — may he close this VS Code tab, or must he keep it open and why? He keeps no
//      notes, so a session whose fate is unstated stays in his sidebar forever and buries the live
//      work.
//   2. A NEXT ACTION — what the next session should do, specifically enough to paste and start.
//   3. A LANE — does that next action continue THIS lane, or start a different one? Without it he
//      cannot tell whether the handoff describes the work he was just watching or something else.
// All three, or it does not count. A cheerful "all done!" with no verdict is exactly the failure.
//
// WHY THE VOCABULARY CHANGED (owner, 2026-08-20). It used to demand "archive / delete / leave open".
// In his words: that wording never said "what it literally means or how im supposed to know when to
// actually close the tab in vscode". "Leave open" described the model's state, not an instruction he
// could act on, so it is no longer accepted — the block must name the tab and the lane.

// Matched against a whitespace-collapsed, lowercased copy: re-wrapping a block must never change
// the verdict, and neither must capitalisation.
const flatten = (text) => String(text ?? "").replace(/\s+/g, " ").toLowerCase();

// The tab verdict. Deliberately narrow, and deliberately about the TAB rather than the "session":
// he acts on a window in front of him, not on the model's internal state. Keeping it open is only a
// verdict when it carries a reason, so the "keep" arm requires because/until/so/while after it.
const TAB_VERDICT =
  /\b(safe to close|done with this tab|(you can |ok to )?close (this|the) tab|keep (this|the) tab open (because|until|so|while)\b)/;

// Which lane the next action belongs to. "same lane" and "new lane" both pass; so does naming the
// branch or PR outright, which is stronger. A handoff that names no lane is the ambiguity he hit.
const LANE = /\b(same lane|this lane|a new lane|different lane|no lane|not lane-scoped|lane\/|branch |pr #\d|#\d{2,})/;

// The next-action half. "handoff" alone is not enough — the word is easy to type and says nothing.
const NEXT_ACTION = /\b(next session|next step|next action|hand ?off|resume|pick up|start here|paste)\b/;

/**
 * Does this assistant message carry a usable handoff block?
 * @param {string} text - the final assistant message of a turn
 * @returns {{ ok: boolean, missing: string[] }} missing names the halves that are absent
 */
export function checkHandoffBlock(text) {
  const flat = flatten(text);
  const missing = [];
  if (!TAB_VERDICT.test(flat)) {
    missing.push('tab verdict ("safe to close" / "keep this tab open because ...")');
  }
  if (!NEXT_ACTION.test(flat)) missing.push("next action for the following session");
  if (!LANE.test(flat)) missing.push("which lane that next action is on (same lane / a new lane / name it)");
  return { ok: missing.length === 0, missing };
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
