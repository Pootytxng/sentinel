#!/usr/bin/env node
// PostToolUse(Write|Edit) hook — when a Compy UI file (src/**/*.{tsx,css}) is edited, inject a
// reminder to run the `self-review` skill before claiming the change done. The owner asked to be made
// "more vigilant" of the self-review law after shipping a muted button + duplicate banner (2026-06-20).
//
// Design: PATH-based (reads tool_input.file_path — works in any worktree, unlike a git-diff Stop hook
// that only sees the main checkout); NON-blocking (additionalContext only — never wedges a turn);
// throttled to ~once / 15 min per session so it nudges without spamming on every edit.
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let data;
try {
  data = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

const fp = data?.tool_input?.file_path || "";
if (!/[\\/]src[\\/].*\.(tsx|css)$/.test(fp)) process.exit(0); // only UI source files

// Throttle: at most once per ~15 min per session (keyed by session_id).
const sid = String(data?.session_id || "x").replace(/[^a-z0-9-]/gi, "");
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
  /* ignore */
}

const msg =
  "UI file changed (src/**/*.{tsx,css}). Before claiming this done, run the `self-review` skill — " +
  "which now means DISPATCH the `self-reviewer` subagent (sonnet) with the quoted ask + files/elements " +
  "touched, and quote its SELF-REVIEW verdict block in your report. Do NOT capture or cdp-eval inline " +
  "in this session (token law 2026-07-05: evidence stays in the worker's context). Green tsc/vitest " +
  "are NOT a visual review (they missed the muted button + duplicate banner).";

process.stdout.write(
  JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: msg } }),
);
process.exit(0);
