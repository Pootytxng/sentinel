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
//   1. A DISPOSITION — is this session archive / delete / leave open? He keeps no notes, so a
//      session whose fate is unstated stays in his sidebar forever and buries the live work.
//   2. A NEXT ACTION — what the next session should do, specifically enough to paste and start.
// Both, or it does not count. A cheerful "all done!" with no disposition is exactly the failure.

// Matched against a whitespace-collapsed, lowercased copy: re-wrapping a block must never change
// the verdict, and neither must capitalisation.
const flatten = (text) => String(text ?? "").replace(/\s+/g, " ").toLowerCase();

// The disposition vocabulary. Deliberately narrow: these are the three fates a session can have in
// his sidebar, and a fuzzy synonym list would let a vague sentence pass as a decision.
const DISPOSITION = /\b(archiv(e|ed|able)|delet(e|ed|able)|leave (it )?open|keep (it )?open|still open)\b/;

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
  if (!DISPOSITION.test(flat)) missing.push("disposition (archive / delete / leave open)");
  if (!NEXT_ACTION.test(flat)) missing.push("next action for the following session");
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
