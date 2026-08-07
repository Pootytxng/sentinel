// Big-read guard — deny a Read that has no offset/limit and would return more of a file than a
// fresh context can afford, and say in the refusal exactly how to bound it.
//
// Why this exists: on 2026-08-07 the session hit the harness dialog "Autocompact is thrashing: the
// context refilled to the limit within 3 turns of the previous compact, 3 times in a row. A file
// being read or a tool output is likely too large for the context window." Three unbounded reads of
// this repo's largest documents does exactly that on their own: at roughly 4 bytes per token,
// docs/BACKLOG.md alone is ~33k tokens, and a just-compacted window has on the order of 110k of
// headroom. CLAUDE.md TOKEN LAW already says to read big docs by section — but prose does not fail
// anything, and the token audit found that rule broken over a hundred times on one file.
//
// It is a real DENY rather than an advisory nudge, for two reasons. "Is this file too large to read
// whole" is a mechanically checkable fact, which is the same property that makes the subagent
// model-routing guard a deny while the workflow-usage guard is only a reminder. And on PreToolUse an
// "allow" reason is delivered after the tool has already been cleared to run, so the tokens are
// spent by the time the advice lands — for a COST guard specifically, allow is worthless.
//
// The refusal is escapable in one move: pass an explicit limit. That is deliberate, not a hole.
// Sometimes the whole file genuinely is the answer; the point is to make that a decision instead of
// a reflex, and to make the expensive path the one you have to type.
//
// Fails OPEN on every uncertainty — bad stdin, missing path, unstattable file, or a format where
// offset/limit do not apply (images, PDF, notebooks, which take `pages` or nothing at all). This
// must never be the reason a legitimate build stalls; it exists to catch one narrow, costly mistake.

import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { extname } from "node:path";

/** Bytes a default Read may return before it has to be bounded. ~12k tokens at ~4 bytes/token. */
const MAX_UNBOUNDED_BYTES = 48_000;

/** The Read tool's own default line cap: a longer file returns only its first this-many lines. */
const READ_DEFAULT_LINES = 2000;

/** Head bytes to probe, at most. A pathological file must never be slurped whole just to measure. */
const PROBE_BYTES = 4 * 1024 * 1024;

/** Formats where offset/limit are not accepted, so denying one would be an inescapable block. */
const EXEMPT_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
  ".ico",
  ".pdf",
  ".ipynb",
]);

const allow = () => process.exit(0);

/**
 * Measure the slice a default Read would actually return — not the file size. For a very long file
 * those differ a lot: the line cap means only the head comes back, and reporting the full size
 * would overstate the cost in the very message that is supposed to be trustworthy.
 */
function measureReturnedSlice(filePath, size) {
  let fd;
  try {
    fd = openSync(filePath, "r");
  } catch {
    return null;
  }
  try {
    const cap = Math.min(size, PROBE_BYTES);
    const buf = Buffer.allocUnsafe(cap);
    let filled = 0;
    while (filled < cap) {
      const n = readSync(fd, buf, filled, cap - filled, filled);
      if (n <= 0) break;
      filled += n;
    }
    let lines = 0;
    for (let i = 0; i < filled; i++) {
      if (buf[i] === 0x0a) {
        lines += 1;
        if (lines === READ_DEFAULT_LINES) return { bytes: i + 1, lines, atLeast: false };
      }
    }
    // Fewer than the line cap inside the probe. If the probe itself ran out first, the returned
    // slice is at least PROBE_BYTES — report it as a floor rather than guessing at the rest.
    if (filled < size) return { bytes: filled, lines, atLeast: true };
    const trailing = filled > 0 && buf[filled - 1] !== 0x0a ? 1 : 0;
    return { bytes: filled, lines: lines + trailing, atLeast: false };
  } catch {
    return null;
  } finally {
    try {
      closeSync(fd);
    } catch {
      /* already closed — nothing to salvage and nothing to report */
    }
  }
}

let input = {};
try {
  // stdin is fd 0; a hook that cannot read its own input has nothing to judge.
  input = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  allow();
}

if (String(input?.tool_name || "Read") !== "Read") allow();

const toolInput = input?.tool_input || {};
const filePath = String(toolInput.file_path || "");
if (!filePath) allow();

// Already bounded by the caller — offset, limit, or a PDF page range all mean a deliberate slice.
if (toolInput.offset !== undefined || toolInput.limit !== undefined || toolInput.pages !== undefined) {
  allow();
}

if (EXEMPT_EXTENSIONS.has(extname(filePath).toLowerCase())) allow();

let size = 0;
try {
  const st = statSync(filePath);
  if (!st.isFile()) allow();
  size = st.size;
} catch {
  allow();
}

// Cheap early exit: a file smaller than the budget cannot return more than the budget.
if (size < MAX_UNBOUNDED_BYTES) allow();

const slice = measureReturnedSlice(filePath, size);
if (!slice) allow();
if (slice.bytes < MAX_UNBOUNDED_BYTES) allow();

const kb = Math.round(slice.bytes / 1024);
const tokens = Math.round(slice.bytes / 4 / 100) / 10;
const floor = slice.atLeast ? "at least " : "";
const lineNote = slice.atLeast ? `${slice.lines}+ lines` : `${slice.lines} lines`;

const reason = [
  `Blocked: Read of ${filePath} with no offset/limit returns ${floor}${kb} KB (${lineNote}, ~${tokens}k tokens) in a single turn.`,
  `That is the autocompact-thrash pattern the harness warns about — three reads this size refill a freshly compacted context.`,
  ``,
  `Bound it instead:`,
  `  1. Grep the file for what you actually need (output_mode "content", -n, -C 3), then Read that neighbourhood only.`,
  `  2. Read with offset + limit once you know the line range.`,
  `  3. If the whole file really is the answer, pass an explicit limit (e.g. limit: ${READ_DEFAULT_LINES}). That is the acknowledgment, not a workaround — but spend it knowingly.`,
].join("\n");

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  }) + "\n",
);
process.exit(0);
