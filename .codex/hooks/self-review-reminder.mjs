#!/usr/bin/env node
// Codex PostToolUse(apply_patch) hook — when an apply_patch edit touches a Compy UI file
// (src/**/*.{tsx,css}), inject a NON-BLOCKING advisory reminder to run the self-review discipline
// before the change is claimed done. The self-review law exists because green tsc/vitest + a glance
// once shipped a muted-on-accent button + a duplicate banner (CLAUDE.md § SELF-REVIEW + BUG→GUARD,
// 2026-06-20). This is the SOLE hook the Codex lane retains; the Claude-lane automation
// (stop-continue, ship-reminder, the subagent model/throttle guards, the context-size advisor) was
// REMOVED in the corrective follow-up (2026-07-20) as not-Codex-native and/or not-read-only.
//
// Codex contract this hook is written against (source-verified in codex-rs, 2026-07-20):
//   * Matcher = the Codex tool name `apply_patch`. Codex aliases apply_patch ↔ Write/Edit
//     (codex-rs/core/src/tools/hook_names.rs), so matching the Codex-native name is correct; we do
//     NOT match the Claude names "Write"/"Edit" here.
//   * Codex delivers the edit payload in `tool_input`; the official Codex hooks documentation
//     confirms apply_patch surfaces the patch under `tool_input.command`. This hook still reads it
//     DEFENSIVELY as a generic string (apply_patch is a command-shaped tool; the patch body carries
//     `*** Add/Update/Delete/Move File: <path>` headers) and scans it for a UI path — the defensive
//     parse also honors `tool_input.file_path` as a fallback shape and FAILS SILENT (no reminder)
//     whenever it cannot positively identify a UI file, because an advisory nudge must never block
//     and a missed nudge is acceptable where a false nudge is not.
//
// A green hooks-selftest proves THIS parse/throttle logic against a documented-shape fixture. It
// does NOT prove Codex activates this hook in-product — only a trusted Codex runtime run proves that.
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let data;
try {
  data = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0); // not JSON on stdin → nothing to advise on
}

// Gather every string the edit payload might carry a touched path in, WITHOUT asserting a schema:
// apply_patch's `command` (string or arg-array), plus a `file_path` fallback if a surface passes one.
const ti = (data && data.tool_input) || {};
const parts = [];
if (typeof ti.command === "string") parts.push(ti.command);
else if (Array.isArray(ti.command)) parts.push(ti.command.join("\n"));
if (typeof ti.file_path === "string") parts.push(ti.file_path);
const blob = parts.join("\n");
if (!blob) process.exit(0);

// A UI file is a `src/….{tsx,css}` path where `src` is a real path segment (so `mysrc/x.tsx` and
// `dist/src/x.css` won't false-fire — the segment must be preceded by start/space/quote/paren/slash).
// apply_patch headers (`*** Update File: src/App.tsx`) and a bare file_path both contain such a token,
// so a single scan of the whole blob covers either shape with no shape assumption.
const UI = /(^|[\s"'`(\\/])src[\\/][^\s"'`)]*\.(tsx|css)\b/;
if (!UI.test(blob)) process.exit(0);

// Throttle: at most once per ~15 min per session (keyed by session_id), tmpdir-only side effect.
const sid = String((data && data.session_id) || "x").replace(/[^a-z0-9-]/gi, "");
const marker = join(tmpdir(), `compy-selfreview-${sid}`);
const NOW = Date.now();
try {
  if (NOW - statSync(marker).mtimeMs < 15 * 60 * 1000) process.exit(0);
} catch {
  /* no marker yet → fire */
}
try {
  writeFileSync(marker, String(NOW));
} catch {
  /* best-effort; a failed throttle write must not block the edit */
}

const msg =
  "A Compy UI file (src/**/*.{tsx,css}) was edited. Before this change is claimed done, run the " +
  "self-review discipline: actually LOOK at the rendered result at real resolution — legibility/" +
  "contrast on colored fills, duplication vs a sibling surface, hover/empty/loading states, layout " +
  "overflow, stale wording, and every part of the ask. This is the project self-review law " +
  "(CLAUDE.md § SELF-REVIEW + BUG→GUARD). The read-only `self-reviewer` agent " +
  "(.codex/agents/self-reviewer.toml) is the evidence-gatherer. Green tsc/vitest are NOT a visual " +
  "review — they once missed a muted-on-accent button and a duplicate banner. Advisory only; nothing " +
  "is blocked.";

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: msg },
  })
);
process.exit(0);
