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
import { join, relative } from "node:path";

let data;
try {
  data = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0); // not JSON on stdin → nothing to advise on
}

// Collect the FILE PATHS this edit actually targets — NOT the whole patch text. apply_patch names
// the touched files in its envelope HEADERS (`*** Add|Update|Delete|Move File: <path>` and the
// rename target `*** Move to: <path>`); those header paths are repo-ROOT-relative. Reading ONLY the
// headers (never arbitrary body/context lines) is what stops a backend patch that merely MENTIONS a
// frontend path in a changed line from false-firing. `tool_input.file_path` is honored as a fallback
// shape. (corrective follow-up 2026-07-20: the old regex scanned the entire blob and matched any
// `src/` substring, so `dist/src/x.css` and a body-mention both false-fired — this anchors instead.)
const ti = (data && data.tool_input) || {};
const cmd =
  typeof ti.command === "string"
    ? ti.command
    : Array.isArray(ti.command)
      ? ti.command.join("\n")
      : "";
const candidates = [];
const FILE_HEADER = /^\*\*\*\s+(?:Add|Update|Delete|Move)\s+File:\s+(.+?)\s*$/gm;
const MOVE_TO = /^\*\*\*\s+Move to:\s+(.+?)\s*$/gm;
for (const re of [FILE_HEADER, MOVE_TO]) {
  let m;
  while ((m = re.exec(cmd)) !== null) candidates.push(m[1]);
}
if (typeof ti.file_path === "string") candidates.push(ti.file_path);
if (!candidates.length) process.exit(0);

// A UI file is a repo-ROOT `src/….{tsx,css}`. Normalize each candidate (strip surrounding quotes,
// make an absolute path repo-root-relative, forward-slash it, drop a leading `./` or `/`) and require
// it to START with `src/` — so `src-tauri/src/lib.rs` (backend) and `dist/src/generated.css` (build
// artifact) are correctly EXCLUDED, and only a genuine frontend source file fires.
const isUiFile = (raw) => {
  let p = String(raw).trim().replace(/^["'`]+|["'`]+$/g, "");
  if (/^([A-Za-z]:[\\/]|[\\/])/.test(p)) p = relative(process.cwd(), p);
  p = p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
  return /^src\/.*\.(tsx|css)$/i.test(p);
};
if (!candidates.some(isUiFile)) process.exit(0);

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
