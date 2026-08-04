// Sentinel autopilot — Stop hook (opt-in task-completion loop).
//
// Pattern: a Stop hook that, when an autopilot run is ARMED, blocks Claude from
// stopping and re-feeds the pending task queue so it keeps working through the
// list. OFF by default. Three independent safety guards prevent runaway loops:
//   1. stop_hook_active   — the harness sets this true once we've already forced
//                           a continuation; we always allow the stop then.
//   2. remaining_continues — a hard budget in autopilot.json, decremented each
//                           block, so it can NEVER loop forever (token safety).
//   3. MAX_CONTINUES clamp — 2026-07-18: autopilot chaining tasks through one
//                           session is exactly what manufactures the >150k
//                           contexts the context-size-advisor hook exists to
//                           catch (docs/superpowers/specs/2026-07-01-token-
//                           routing-protocol.md called this out as an unenforced
//                           behavioral convention — "cap at 1-2 tasks" was a doc
//                           note, not code). Now enforced: whatever the state
//                           file requests, this hook clamps remaining_continues
//                           down to MAX_CONTINUES on read, so autopilot can
//                           never silently run a session past the point where
//                           it collides with the token-efficiency rules below.
//
// State file: ../autopilot.json (i.e. .claude/autopilot.json), resolved relative
// to THIS script so it doesn't depend on the hook's working directory.
//
// Arm:    set { "active": true, "tasks": ["...", ...], "remaining_continues": N }
//         (N is a request — actual budget used is min(N, MAX_CONTINUES))
// Disarm: set "active": false  (or empty the tasks array)  — anytime.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE = join(__dirname, "..", "autopilot.json");
// 2026-08-03 (owner standing grant): raised 2 -> 8. The clamp existed because chaining tasks in one
// session manufactured >150k contexts and a weekly cap-out. The owner's instruction is to stop
// stalling on approvals he grants anyway, so the budget rises — but the TOKEN LAW does not relax:
// terse reports, section reads, minimal anchors. If context-size-advisor starts firing, lower this
// again rather than absorbing the cost silently. Budget-capped and stop_hook_active-guarded as before.
const MAX_CONTINUES = 8;

/** Allow the stop. Optional one-line note shown to the user. */
function allow(msg) {
  if (msg) process.stdout.write(JSON.stringify({ systemMessage: msg }) + "\n");
  process.exit(0);
}

function saveQuietly(state) {
  try { writeFileSync(STATE, JSON.stringify(state, null, 2) + "\n"); } catch { /* non-fatal */ }
}

// --- Read the Stop payload from stdin ---------------------------------------
let raw = "";
try { raw = readFileSync(0, "utf8"); } catch { allow(); }

let input = {};
try { input = JSON.parse(raw || "{}"); } catch { allow(); }

// Guard 1: already in a forced continuation -> never re-block.
if (input.stop_hook_active === true) allow();

// Autopilot off (no state file) -> normal stop.
if (!existsSync(STATE)) allow();

let state;
try { state = JSON.parse(readFileSync(STATE, "utf8")); } catch { allow(); }

// Disarmed -> normal stop.
if (!state || state.active !== true) allow();

const tasks = Array.isArray(state.tasks)
  ? state.tasks.filter((t) => typeof t === "string" && t.trim())
  : [];

// Queue empty -> disarm + stop.
if (tasks.length === 0) {
  state.active = false;
  saveQuietly(state);
  allow("Autopilot: task queue empty — disarmed, stopping normally.");
}

// Guard 2: continuation budget.
let budget = Number(state.remaining_continues);
if (!Number.isFinite(budget) || budget <= 0) {
  state.active = false;
  saveQuietly(state);
  allow("Autopilot: continuation budget exhausted — disarmed. Re-arm .claude/autopilot.json to resume.");
}

// Guard 3: hard clamp, regardless of what was requested in the state file.
if (budget > MAX_CONTINUES) budget = MAX_CONTINUES;

// Consume one unit and persist BEFORE blocking.
budget -= 1;
state.remaining_continues = budget;
saveQuietly(state);

// Block the stop; feed the queue + the rules back to the model.
const list = tasks.map((t, i) => `  ${i + 1}. ${t}`).join("\n");
const reason =
  `AUTOPILOT ACTIVE — do not stop yet. Pending tasks in .claude/autopilot.json:\n${list}\n\n` +
  `Do the next pending task now, then remove it from the "tasks" array as you finish it ` +
  `(commit/save work as you go). Continuation budget remaining after this: ${budget}.\n\n` +
  `STOP NOW (set "active": false in .claude/autopilot.json, then stop and ask the user) if:\n` +
  `  • the next step is a point of no return — irreversible, outward-facing, or a ` +
  `product-code / gate / installer / beta-ref change, or anything needing the user's approval; or\n` +
  `  • you are blocked or need a decision; or\n` +
  `  • the queue is empty.\n` +
  `Never use autopilot to push past an approval gate or the project's locked safety rules.`;

process.stdout.write(JSON.stringify({ decision: "block", reason }) + "\n");
process.exit(0);
