#!/usr/bin/env node
// PreToolUse(Agent) hook — subagent model-routing guard (2026-07-18).
//
// CLAUDE.md's "Subagent routing" rule (§ Reports, subagents, self-review; the full table lives in
// docs/COWORK_HANDOFF.md → Subagent-model orchestration): cheapest capable model by default (sonnet,
// via CLAUDE_CODE_SUBAGENT_MODEL), opus only where adversarial judgment is provably the point
// (the one standing exception: web-design-director), fable never. That's been true by
// construction for every NAMED custom agent (checked 2026-07-18: 3 of 4 in .claude/agents/*.md
// pin sonnet, web-design-director pins opus, matching the documented exception). What was never
// checked is the Agent tool's own per-call `model` field, which can override an agent's pinned
// frontmatter model at invocation time. This hook closes that gap: it's a real DENY, not an
// advisory nudge, because "which model" is a mechanically checkable fact, unlike "was this
// spawn necessary" (see subagent-throttle.mjs for the necessity/frequency question, which stays
// advisory because it isn't mechanically decidable).
//
// Fails OPEN on any read/parse error or unknown subagent_type — this hook should never be the
// reason a legitimate build stalls; it exists to catch a specific, narrow mistake.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ALLOWED_NON_SONNET = {
  opus: ["web-design-director"], // CLAUDE.md's one documented exception
  fable: [], // never, no exceptions
};

let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  process.exit(0);
}

const toolInput = input?.tool_input || {};
const requestedModel = String(toolInput.model || "").toLowerCase();
const subagentType = String(toolInput.subagent_type || "");

// No explicit model override on this call -> falls back to CLAUDE_CODE_SUBAGENT_MODEL or the
// named agent's own frontmatter pin, both already governed elsewhere. Nothing to check.
if (!requestedModel || requestedModel === "sonnet" || requestedModel === "haiku") {
  process.exit(0);
}

const allowedTypes = ALLOWED_NON_SONNET[requestedModel];
if (allowedTypes === undefined) {
  // Unrecognized model string — don't guess, allow it through rather than block on uncertainty.
  process.exit(0);
}

if (allowedTypes.includes(subagentType)) {
  process.exit(0); // the one documented exception
}

const reason =
  `Blocked: Agent call requests model="${requestedModel}" for subagent_type="${subagentType}", ` +
  `which is not the documented exception (CLAUDE.md "Subagent routing": sonnet is the ` +
  `default, opus only for web-design-director, fable never for subagents). If this override is ` +
  `deliberate and the exception list is stale, update ALLOWED_NON_SONNET in ` +
  `.claude/hooks/subagent-model-guard.mjs and CLAUDE.md together — don't just retry past this.`;

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  }) + "\n"
);
process.exit(0);
