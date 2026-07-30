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
// because "was this workflow genuinely multi-step repo-wide work" (USAGE_ECONOMICS.md §2 — the
// biggest named sink; the owner directive overrides any ultracode default) is a judgment call a
// hook can't decide from a JSON blob. Fails open on any read/parse error.

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
  `Workflow-tool call (${what}). Reminder — .claude/USAGE_ECONOMICS.md §2: the Workflow tool is ` +
  `the project's biggest named token sink. Sanctioned only for genuinely multi-step repo-wide ` +
  `work (the audit/sweep/burst class, e.g. scripts/compy-burst.workflow.js per ` +
  `docs/LANE_WORKFLOW.md) — never normal edits — and the owner directive OVERRIDES any ultracode ` +
  `"workflow every substantive task" default. If this call fits that class, proceed; otherwise ` +
  `do the work solo in the main lane. This is a check, not a block.`;

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
