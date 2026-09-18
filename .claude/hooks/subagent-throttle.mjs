#!/usr/bin/env node
// PreToolUse(Agent) hook — subagent FAN-OUT advisor. Narrowed 2026-09-18 (#479).
//
// History: written 2026-07-18 to nudge against spawning at all — every 3rd Agent call it asked
// "should the main agent just do this inline?", citing USAGE_ECONOMICS.md §1. On 2026-08-18 the
// token-economy law reversed that §1: context is ~85% of spend, and a subagent absorbs verbose
// reads in its own fresh window and returns only a summary, so **delegating verbose work is the
// recommended default**. The hook kept nudging the other way for a month — a guard contradicting
// the law it sat next to, and every 3rd delegation paid for a reminder to not delegate.
//
// What is still worth catching is FAN-OUT: many spawns in a short burst. Each subagent pays its
// own prefix build, so a burst multiplies cost without adding a single fresh window's worth of
// benefit that one well-briefed worker would not also give. A single delegation — or a steady
// sequence of them — is never flagged. Advisory only (never blocks); any read/parse error is a
// silent allow, same failure posture as the other hooks in this repo.
//
// Tests: scripts/subagent-throttle-hook.test.mjs (vitest excludes .claude/**).

import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const BURST = 4; // spawns ...
export const WINDOW_MS = 120_000; // ... inside this sliding window = fan-out

// Pure: given the prior state and this spawn's time, return the new state and the warning (or null).
// Warns once per burst: after a warning, it stays quiet until the window has fully drained.
export function decide(state, now) {
  const recent = (Array.isArray(state?.spawns) ? state.spawns : [])
    .filter((t) => typeof t === "number" && now - t < WINDOW_MS)
    .concat(now);
  const lastWarn = typeof state?.lastWarn === "number" ? state.lastWarn : -Infinity;
  const inBurstAlreadyWarned = now - lastWarn < WINDOW_MS;
  if (recent.length < BURST || inBurstAlreadyWarned) {
    return { state: { spawns: recent, lastWarn: state?.lastWarn ?? null }, warning: null };
  }
  const warning =
    `SUBAGENT FAN-OUT CHECK — ${recent.length} Agent spawns inside ${WINDOW_MS / 1000}s. ` +
    `Delegating verbose work to a subagent is the law (token-economy skill) and is not what this ` +
    `flags. A BURST is: each spawn pays its own prefix build. If these briefs overlap, fold them ` +
    `into one well-briefed worker; if they are genuinely independent, proceed — this is a check, ` +
    `not a block.`;
  return { state: { spawns: recent, lastWarn: now }, warning };
}

function main() {
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    process.exit(0);
  }
  const sid = String(input?.session_id || "x").replace(/[^a-z0-9-]/gi, "");
  const marker = join(tmpdir(), `compy-subagent-burst-${sid}.json`);

  let prior = {};
  try {
    prior = JSON.parse(readFileSync(marker, "utf8"));
  } catch {
    /* first spawn this session */
  }
  const { state, warning } = decide(prior, Date.now());
  try {
    writeFileSync(marker, JSON.stringify(state));
  } catch {
    /* non-fatal; worst case a burst goes unflagged */
  }
  if (!warning) process.exit(0);

  // additionalContext is the field that reaches the model on an "allow" (permissionDecisionReason
  // is only surfaced on deny/ask), and "allow" means this can never block a legitimate spawn.
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        additionalContext: warning,
      },
    }) + "\n",
  );
  process.exit(0);
}

const entry = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (entry && import.meta.url.endsWith(entry.slice(entry.lastIndexOf("/")))) main();
