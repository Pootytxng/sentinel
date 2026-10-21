#!/usr/bin/env node
// PreToolUse(Workflow) hook — Workflow-tool usage guard (2026-07-22).
//
// The matcher name is EMPIRICALLY CONFIRMED, not assumed: on 2026-07-22 a temporary catch-all
// PreToolUse logging hook captured `"tool_name":"Workflow"` from a live no-op workflow run
// (0 agents, 12ms), closing USAGE_ECONOMICS.md §6's last open item — docs/LANE_WORKFLOW.md's
// "run via the Workflow tool" phrasing had never been verified against a real tool-call log.
//
// Advisory by design, same split as the Agent-tool pair: subagent-model-guard.mjs DENIES because
// "which model" is mechanically checkable; this hook (like subagent-throttle.mjs) only REMINDS,
// because "is this workflow bounded, and will it say what it dropped" is a judgment call a hook
// can't decide from a JSON blob. Fails open on any read/parse error.
//
// Reworded 2026-10-21 (USAGE_ECONOMICS.md "Owner directive 2026-10-21 — use the budget"). The earlier
// text called the Workflow tool "the biggest named token sink" and told sessions to work solo unless
// the job was repo-wide. The owner's standing ask is the opposite: the weekly cap is a resource he
// wants used, and ending the week well under it with startable work parked is the failure. The
// reminder now guards against WASTE (unbounded scope, silent truncation), never against spend.

import { readFileSync } from "node:fs";

let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  process.exit(0);
}

const ti = input?.tool_input || {};
const what = ti.name
  ? `named workflow "${ti.name}"`
  : ti.scriptPath
    ? `script ${ti.scriptPath}`
    : "an inline script";

const reason =
  `Workflow-tool call (${what}). Reminder — .claude/USAGE_ECONOMICS.md "Owner directive 2026-10-21": ` +
  `the weekly budget is a resource to USE, and the Workflow tool is sanctioned for any genuinely ` +
  `multi-step work (audit, sweep, burst, implement-and-verify fan-outs), not only the repo-wide ` +
  `class. The ultracode opt-in stands whenever a system-reminder says it is on. What this check ` +
  `asks: keep the scope bounded and named, prefer pipeline() over barriers, and log() any coverage ` +
  `the script drops so a partial sweep never reads as a full one. This is a check, not a block.`;

// Advisory-only. permissionDecisionReason on an "allow" is NOT delivered to the model (only on
// deny/ask); additionalContext is the field that reaches Claude on PreToolUse. permissionDecision
// stays "allow" so this can never block a legitimate run. Same shape as subagent-throttle.mjs.
process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      additionalContext: reason,
    },
  }) + "\n"
);
process.exit(0);
