#!/usr/bin/env node
// PostToolUse(Bash) hook — when a `tauri build` just ran, inject a reminder that the ship LAW applies:
// the owner never installs; Claude runs scripts/ship-reinstall.ps1, stamp-verifies live==HEAD, and
// updates the RELEASE_STATE.md Snapshot row in the same commit. Companion to .claude/skills/ship
// (same design as self-review-reminder.mjs: PATH/content-based, NON-blocking additionalContext,
// throttled so it nudges once per build session rather than on every bash call).
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let data;
try {
  data = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

const cmd = String(data?.tool_input?.command || "");
if (!/tauri[\s"']+build/.test(cmd)) process.exit(0); // only fire on tauri build invocations

// Throttle: at most once per ~10 min per session (a build takes minutes; one nudge per build).
const sid = String(data?.session_id || "x").replace(/[^a-z0-9-]/gi, "");
const marker = join(tmpdir(), `compy-shipreminder-${sid}`);
const NOW = Date.now();
try {
  if (NOW - statSync(marker).mtimeMs < 10 * 60 * 1000) process.exit(0);
} catch {
  /* no marker yet → fire */
}
try {
  writeFileSync(marker, String(NOW));
} catch {
  /* ignore */
}

const msg =
  "A tauri build just ran. The ship LAW applies (owner NEVER installs; ONE installer on his Desktop): " +
  "run scripts/ship-reinstall.ps1 via the call operator — powershell -NoProfile -Command \"& 'C:\\Users\\Kuya\\code\\sentinel\\scripts\\ship-reinstall.ps1'\" — " +
  "then prove live==build via the embedded stamp (never exe hash), update the RELEASE_STATE.md Snapshot " +
  "row (installer SHA-256 + commit) in the same docs commit, and report: \"your live app is now <commit>, " +
  "one installer on the Desktop, nothing for you to do.\" Full procedure: .claude/skills/ship.";

process.stdout.write(
  JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: msg } }),
);
process.exit(0);
