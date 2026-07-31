// The launch brief — the durable instructions that replace Kuya pasting a prompt.
//
// The launcher writes one per task, as machine state (never in the repository — a brief is what
// happened on this machine, not source). The SessionStart hook reads it and hands it to the session
// on EVERY start, including the ones that follow compaction, which is the difference between a task
// that survives losing its conversation and one that does not.
//
// The rendered text lives in the file next to the facts it was rendered from. That is deliberate:
// `.claude/hooks/session-root-assert.mjs` is copied alone into folders where `tools/entry` does not
// exist (tracked-hooks.test.mjs pins it to `node:` imports only), so it cannot call the renderer. It
// carries the text; it does not compose it. One writer, no second opinion about what the brief says.

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";

import { BRIEF_DIR, briefFile, readBrief } from "../../.claude/hooks/session-root-assert.mjs";

// Where a brief lives and how it is read belong to the hook — it is the reader, and it is copied
// into folders this file cannot reach. Composing one belongs here.
export { BRIEF_DIR, briefFile, readBrief };

const count = (n) => Number(n).toLocaleString("en-US");
const tierWord = (b) => (b.marathon ? "marathon" : "standard");

/** The brief itself. Pure, and every line is something the launch actually established. */
export function renderBrief(brief) {
  const lines = [
    `# Task #${brief.issue} — ${brief.title}`,
    "",
    "The Compy entrypoint launched this session for this one task. Everything below was verified",
    "against this machine at launch — it is not a prompt asserting things about itself.",
    "",
    `- **Issue:** #${brief.issue}${brief.lane ? ` · lane ${brief.lane}` : ""}`,
    `- **Worktree:** \`${brief.folder}\``,
    `- **Branch:** \`${brief.branch}\`${brief.base ? ` (created from ${String(brief.base).slice(0, 7)})` : ""}`,
    `- **Context tier:** ${tierWord(brief)} — ${count(brief.window)} tokens`,
  ];
  if (brief.claimExpires) lines.push(`- **Claim:** yours, posted, until ${brief.claimExpires}`);
  if (brief.nextAction) lines.push(`- **Next action at launch:** ${brief.nextAction}`);
  lines.push("");

  if (brief.authorization) {
    lines.push("## Authorization", "", brief.authorization.trim(), "");
  }

  lines.push(
    "## Working here",
    "",
    "This brief is re-supplied on every SessionStart, so a compaction or an extension restart loses",
    "the conversation but never the task. Work in the worktree above and nowhere else. The claim is",
    "already posted — read `docs/WORK_CONTROL.md` before the first write, and when the scope changes,",
    "change the issue rather than this brief.",
  );
  return lines.join("\n");
}

/** The first message, so the session starts working without anyone typing. Short by design. */
export function openingMessage({ mode, brief }) {
  if (!brief) return null;
  const head = `#${brief.issue} — ${brief.title}`;
  return mode === "resume"
    ? `Resume ${head}. Your launch brief is already in context; pick the work up where it stands.`
    : `Begin ${head}. Your launch brief is already in context; start with the next action it names.`;
}

/** A window title Kuya can pick out of a row of VS Code tabs. */
export function sessionTitle(brief) {
  if (!brief) return null;
  const head = `#${brief.issue} `;
  const room = 60 - head.length;
  const title = brief.title ?? "";
  return head + (title.length > room ? `${title.slice(0, room - 1).trimEnd()}…` : title);
}

/**
 * The digest of exactly what a session will be handed.
 *
 * Hashing the RENDERED text, not the whole record: the text is the thing that becomes authoritative
 * context, and the record also carries fields (the opening lines, the window title) that no session
 * is instructed by. A hash over the whole file would break on a harmless field and pass on nothing
 * that matters more.
 */
export const briefHash = (text) => createHash("sha256").update(String(text ?? ""), "utf8").digest("hex");

/** Cap the durable brief so an unbounded field cannot become an unbounded instruction. */
export const MAX_BRIEF_CHARS = 4000;

export function writeBrief(brief, { dir = BRIEF_DIR, now = new Date() } = {}) {
  let text = renderBrief(brief);
  // The 2500 ceiling lived only in a test, which is a measurement of the fixture rather than a limit
  // on production. `nextAction` and the handoff excerpt come off a board field and an issue comment,
  // and neither has a length anybody controls.
  let truncated = false;
  if (text.length > MAX_BRIEF_CHARS) {
    // Cut at a line boundary and SAY so, rather than stopping mid-sentence and inventing a meaning.
    const cut = text.slice(0, MAX_BRIEF_CHARS);
    text = `${cut.slice(0, cut.lastIndexOf("\n") + 1 || cut.length)}\n\n_(brief truncated at ${MAX_BRIEF_CHARS} characters — the issue itself is the full record.)_\n`;
    truncated = true;
  }

  const record = {
    ...brief,
    createdAt: now.toISOString(),
    text,
    truncated,
    // Bound into the launch token and then the lineage, so a session is only handed a brief that is
    // byte-for-byte the one the launcher wrote. Without it, any stale or edited file under
    // %LOCALAPPDATA% that still parsed became authoritative instructions for a verified session.
    hash: briefHash(text),
    opening: { launch: openingMessage({ mode: "launch", brief }), resume: openingMessage({ mode: "resume", brief }) },
    sessionTitle: sessionTitle(brief),
  };
  const file = briefFile({ issue: brief.issue, dir });
  mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${randomUUID().slice(0, 8)}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(tmp, file);
  return { file, hash: record.hash, truncated };
}
