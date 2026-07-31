#!/usr/bin/env node
// PreToolUse(Agent) hook — subagent-spawn throttle advisor (2026-07-18).
//
// Context: the 2026-07-02 usage audit found 53% of burn was subagent-heavy. Model routing for
// that is ALREADY code-enforced (CLAUDE_CODE_SUBAGENT_MODEL=sonnet in settings.json + every
// named agent in .claude/agents/*.md pinned sonnet except the one documented opus exception,
// web-design-director — verified 2026-07-18, no further guard needed there). What's NOT
// enforced is spawn FREQUENCY/NECESSITY: "never spawn for small edits/obvious refactors" is a
// sentence in USAGE_ECONOMICS.md §1, nothing checks it in the moment.
//
// This hook can't judge whether a given spawn is warranted (that's semantic, not mechanizable
// from a JSON blob), so it does the honest mechanizable thing instead: counts Task spawns in
// THIS session and, once the count crosses a threshold, injects a one-time-per-threshold
// reminder to weigh the spawn against the worth-spawning list before proceeding. It NEVER
// blocks — subagents are frequently the right call (audits, review, search per USAGE_ECONOMICS
// §1), and a hard block here would fight legitimate work with no way to tell the difference.
// Advisory only, same failure posture as the other hooks in this repo: any read/parse error is
// a silent allow.
//
// Guards: PreToolUse hooks don't have a stop_hook_active equivalent, so re-firing is throttled
// by only warning once per THRESHOLD-multiple crossed, not on every single spawn past it.

import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const THRESHOLD = 3; // matches the "1-2 tasks" autopilot convention's spirit, one step looser
                      // since manual (non-autopilot) subagent use is more often deliberate

let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  process.exit(0);
}

const sid = String(input?.session_id || "x").replace(/[^a-z0-9-]/gi, "");
const marker = join(tmpdir(), `compy-subagent-count-${sid}`);

let count = 0;
try {
  count = Number(readFileSync(marker, "utf8")) || 0;
} catch {
  /* first spawn this session */
}
count += 1;
try {
  writeFileSync(marker, String(count));
} catch {
  /* non-fatal; worst case the counter resets and we warn again later than intended */
}

// Only warn on threshold crossings (3, 6, 9, ...), not every spawn past the first threshold.
if (count % THRESHOLD !== 0) process.exit(0);

const reason =
  `SUBAGENT COUNT CHECK — this is Agent spawn #${count} in this session. Before dispatching: ` +
  `does this one fit the worth-spawning list (audits, repo-wide search, diff review, test/log ` +
  `checks, requirements comparison, regression hunts, release validation, security review — ` +
  `USAGE_ECONOMICS.md §1), or is it a small edit/obvious refactor/explanation that the main ` +
  `agent should just do inline? Subagent-heavy sessions were 53% of the 2026-07-02 measured ` +
  `burn. Proceed if it's warranted — this is a check, not a block.`;

// Advisory-only. Note: permissionDecisionReason on an "allow" is NOT delivered to the model as
// context (per Claude Code's hooks reference — it's only surfaced on deny/ask). additionalContext
// is the field that actually reaches Claude here (delivered "next to the tool result" for
// PreToolUse), so that's what carries the reminder. permissionDecision stays "allow" so this can
// never block a legitimate spawn.
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
