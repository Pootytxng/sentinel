#!/usr/bin/env node
// successor-route — #466: which way does this machine launch the next session?
//
// WHY THIS EXISTS. The owner ordered sessions to stop pasting a HANDOFF BLOCK for him to carry into
// a fresh tab and instead launch the successor themselves. Two routes exist and were measured
// working during #466's own research:
//   - a scheduled-tasks launcher routine (mcp__scheduled-tasks__run_scheduled_task against a
//     manually-created "compy-successor-a"/"-b" task) — a genuinely zero-click new session, success
//     text matching "dispatched as session";
//   - a one-click spawn_task chip (mcp__ccd_session__spawn_task) — the owner still has to click it,
//     but nothing is pasted; success text matches "task_id".
// start_session/hand_off_to_session exist but are gated off for this account today.
//
// A launcher routine is ARMED only when the owner has both created it AND turned on useWorktree.
// That toggle is what makes EACH RUN of the routine start in its own fresh worktree of the repo —
// leave it off and the routine runs in its configured folder, the shared main checkout, where every
// write is refused (SUCCESSOR_PREAMBLE STEP 0 below is what a launched session uses to notice this
// and stop cleanly instead of failing on its first write). enabled defaults to true (a routine the
// owner did not explicitly disable is presumed live); useWorktree defaults to false (a routine the
// owner did not explicitly arm for a worktree cannot write and is therefore not a usable route here).
//
// Pure decision logic (pickRoute) is separated from disk I/O (readLauncherTasks) so the routing
// rules are unit-testable without a real scheduled-tasks store — this machine does not have one yet,
// so the live CLI run recorded in the #466 report is expected to print "chip", not "routine".

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { threadLease } from "../tools/entry/claim.mjs";

// The two routines the owner would name "compy-successor-a"/"-b" if he creates them; anything else
// in a scheduled-tasks.json is a different routine (e.g. a daily digest) and must be ignored here.
const LAUNCHER_IDS = ["compy-successor-a", "compy-successor-b"];

function defaultRoot() {
  return process.env.COMPY_ROUTINE_STORE_ROOT || join(process.env.APPDATA || "", "Claude");
}

/**
 * Read every scheduled task, across every org/project folder under the store root. Fail-safe at
 * every level (missing root, missing org/project dir, unreadable or malformed scheduled-tasks.json):
 * a launcher store that does not exist yet is the EXPECTED state on a machine that has not been
 * provisioned, not an error — it degrades to "no tasks found", which pickRoute turns into the chip
 * route.
 * @param {{root?: string}} [opts] - root defaults to %APPDATA%\Claude, override via
 *   COMPY_ROUTINE_STORE_ROOT (used by tests, and by anyone running this from a non-default profile).
 * @returns {Array<object>} raw task objects, every routine in the store (#632's launch guard reads a
 *   routine's stored prompt through its `filePath`)
 */
export function readScheduledTasks({ root = defaultRoot() } = {}) {
  const found = [];
  const sessionsDir = join(root, "claude-code-sessions");
  let orgDirs;
  try {
    orgDirs = readdirSync(sessionsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return found; // no store on this machine yet
  }
  for (const org of orgDirs) {
    let projectDirs;
    try {
      projectDirs = readdirSync(join(sessionsDir, org.name), { withFileTypes: true }).filter((d) => d.isDirectory());
    } catch {
      continue;
    }
    for (const project of projectDirs) {
      const file = join(sessionsDir, org.name, project.name, "scheduled-tasks.json");
      let parsed;
      try {
        parsed = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        continue; // missing or malformed — skip, never throw
      }
      // Real shape (2026-09-18): { scheduledTasks: [...], recordedSkips: {...}, ... } — not a bare
      // array. `.tasks` tolerance is kept in case a differently-shaped store ever uses that key.
      const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.scheduledTasks)
          ? parsed.scheduledTasks
          : Array.isArray(parsed?.tasks)
            ? parsed.tasks
            : [];
      for (const task of list) {
        if (task) found.push(task);
      }
    }
  }
  return found;
}

/** readScheduledTasks narrowed to the #466 launchers, compy-successor-a/-b. */
export function readLauncherTasks(opts) {
  return readScheduledTasks(opts).filter((task) => LAUNCHER_IDS.includes(task?.id));
}

// enabled defaults true (absence is not a disable); useWorktree must be explicitly true (absence is
// not an aim). Asymmetric on purpose — see the header comment.
function isArmed(task) {
  return !!task && task.enabled !== false && task.useWorktree === true;
}

/**
 * Pure routing decision: given the tasks a store lookup returned (already filtered to the two known
 * launcher ids, or anything array-shaped with an `id`), which route should this turn take?
 * @param {Array<object>} tasks
 * @returns {{route: "routine"|"chip", routine: string[], why: string}}
 *   routine lists the armed launcher ids, in the fixed a-then-b order, regardless of input order.
 */
export function pickRoute(tasks) {
  const byId = new Map();
  for (const t of Array.isArray(tasks) ? tasks : []) {
    if (t && typeof t?.id === "string" && !byId.has(t.id)) byId.set(t.id, t);
  }
  const armed = LAUNCHER_IDS.filter((id) => isArmed(byId.get(id)));
  if (armed.length === 0) {
    const present = LAUNCHER_IDS.filter((id) => byId.has(id));
    return {
      route: "chip",
      routine: [],
      why:
        (present.length
          ? `${present.join(", ")} exist but none is armed (enabled, worktree toggle on). Turning the ` +
            "toggle on is owner-only: Routines, the launcher, Edit"
          : "no compy-successor launcher routine exists on this machine") +
        " — spawn_task a one-click chip instead",
    };
  }
  return {
    route: "routine",
    routine: armed,
    why: `${armed.join(", ")} armed — dispatch via mcp__scheduled-tasks__run_scheduled_task`,
  };
}

// The prompt a launched successor actually starts from — it IS the handoff, so it has to say the
// things a pasted block used to say, without anyone pasting it. #466 review: a routine can land a
// successor in the shared main checkout (useWorktree off) where every write is refused, so STEP 0 is
// a self-check the session runs BEFORE trusting anything else here, not after.
export const SUCCESSOR_PREAMBLE = `You are a Compy successor session, launched by a session that finished its part. This prompt IS the handoff; nobody pasted it. If a routine started you, nobody is watching the run: do not stop to ask questions, stop only at owner-bound steps.

STEP 0 — check your folder: run \`git rev-parse --show-toplevel\`. If it prints the shared checkout C:/Users/Kuya/code/sentinel, every write is refused there (the launcher routine's worktree toggle is off). Write nothing: call spawn_task with this whole prompt so the owner gets a one-click worktree session, say that in one line, and stop.
STEP 1 — you inherit no lease. Re-derive state (git, the issue, docs/WORK_CONTROL.md) before trusting anything below, and post your own Ownership claim before any write. Right after it, if \`git config --get core.hooksPath\` prints an absolute path, repoint your own folder: \`git config --worktree core.hooksPath .githooks\`. New app worktrees arrive pinned, and the pin reds every lane's push (#405). Anything owner-bound stops at the owner.
STEP 2 — do the task below.
LAST — if the work is blocked, owner-gated, complete or only waits to be rechecked, post its status on the issue and write \`Successor: none — <why>\`; never re-spawn to recheck a gate. If you have room, keep working here. Launch a successor only for work it can start now, and only with \`node scripts/successor-route.mjs --handoff <file>\` (the file holding the Handoff you posted, ending \`- Claim: released\`; if your own launcher routine is still running, use the other one).

TASK:`;

// #613: two handoffs reached their successors with no `Claim:` line: #583 (an Ownership claim edited
// to say "handed off") and #405 ("This lease is **released**" in prose). The lease fold reads only the
// Claim line, so both leases stayed live after their writers left, and nothing refused either handoff.
// So the preamble is only ever printed together with a Handoff that releases the lease, and the text is
// read by the lease fold itself, so this check and every gate agree on what counts as released: a
// claim in the same text is read after the release and keeps the lease live. It must be `released`:
// the preamble tells the successor it inherits no lease, and a transfer to a chip that is never clicked
// holds its paths with nobody writing.
const RELEASE_LINE = "`- Claim: released`";

/**
 * The full successor prompt for a handoff, or the reason it is refused.
 * @param {string|null|undefined} handoffText - the `### Handoff` block posted on the issue, plus any
 *   task text; it follows `TASK:` verbatim.
 * @returns {{ok: true, prompt: string} | {ok: false, why: string}}
 */
export function successorPrompt(handoffText) {
  if (typeof handoffText !== "string" || !handoffText.trim()) {
    return {
      ok: false,
      why: `no handoff text. Write the \`### Handoff\` you posted on the issue, ending ${RELEASE_LINE}, to a file and pass --handoff <file>`,
    };
  }
  const { claim, handoff } = threadLease([{ body: handoffText }]);
  if (!handoff) {
    return {
      ok: false,
      why: `the text has no \`### Handoff\` section (docs/WORK_CONTROL.md "Lightweight handoff"). An edited Ownership claim or a prose note does not release a lease`,
    };
  }
  if (!handoff.released) {
    return {
      ok: false,
      why: `its Handoff has no ${RELEASE_LINE} line, so the lease fold (threadLease, tools/entry/claim.mjs) still reads the lease as live. Saying "released" in prose, holding, or transferring does not count`,
    };
  }
  if (claim) {
    return {
      ok: false,
      why: `the text also carries an \`### Ownership claim\`, which the lease fold reads after the release, so the lease stays live. Pass only the Handoff`,
    };
  }
  const stop = RESPAWN.test(withoutQuotes(handoffText))
    ? "it tells its successor to re-spawn the same prompt, which is the loop the owner stopped"
    : nextActionStop(handoff.nextAction);
  if (stop) {
    return {
      ok: false,
      why: `${stop}. Launch nothing: post the status on the issue and board, and end with \`Successor: none — <why>\` (owner direction 2026-09-29, #632)`,
    };
  }
  return { ok: true, prompt: `${SUCCESSOR_PREAMBLE}\n${handoffText.trim()}` };
}

// #632: the #620 and #616 chains launched ten successors on 2026-09-29, each rechecking a gate that had
// not moved and re-spawning itself. The owner's direction: no successor for blocked, owner-gated,
// complete or observation-only work. A released Handoff only proves the lease is free; its Exact next
// action decides whether a successor has anything to start. Only the FIRST clause is judged: "review PR
// #464, then the owner applies the patch" starts with work, and the later gate is the successor's to
// meet; a ", then" inside one sentence ends the clause too. Tuned against the 326 released Handoffs on
// the repo's issues (2026-09-29). RESPAWN reads the whole text but only an instruction to loop: a
// Handoff that describes the loop it fixed ("fixed the re-spawn loop") still has work to hand on. The
// launch guard (successor-launch-guard.mjs) reuses it to spot a hand-written successor prompt.
export const RESPAWN = new RegExp(
  [
    // Present and -ing forms only: "re-spawned the same prompt" is history, not an instruction.
    /\b(?:keep\s+)?re-?(?:spawn|launch|run|send|queue)(?:s|es|ing|ning)?\s+(?:this|the|its|your)\s+(?:own\s+)?(?:whole\s+)?(?:same\s+)?(?:prompt|task|chip|successor|session)\b/,
    /\bkeep\s+(?:spawn|launch|run|send|queue|start)(?:s|ing|ning)?\s+(?:this|the|its|your)\s+(?:own\s+)?(?:same\s+)?(?:prompt|task|chip|successor|session)\b/,
    /\b(?:with|send|pass|reuse|launch|spawn|start|run|queue)\s+(?:this|the)\s+same\s+(?:prompt|task|chip)\b/,
    // "run it again" is how a gate or a test is re-run, so only a launch verb re-launches "it".
    /\b(?:launch|spawn|send|queue|trigger|fire)\s+it\s+again\b/,
    /\b(?:launch|spawn|send|queue|trigger|fire|start|run)\s+(?:this|the|your)\s+(?:own\s+)?(?:same\s+)?(?:prompt|task|chip|successor|session)\s+again\b/,
    /\b(?:launch|spawn|start|queue|send)\s+(?:a|another|the\s+next)\s+(?:new\s+)?(?:successor|session|chip)\s+(?:with|from|on)\s+(?:this|the\s+same)\s+(?:prompt|task|handoff)\b/,
  ]
    .map((part) => part.source)
    .join("|"),
  "i",
);
/** A double-quoted phrase is a mention ('the phrase "launch this task again"'), not an instruction. */
export function withoutQuotes(text) {
  return text.replace(/"[^"\n]*"|“[^”\n]*”/g, '""');
}
const CLAUSE_END = /[.;](?:\s|$)|,?\s+(?:and\s+)?then\b/i;
// "Done — merged as …", "Landed in …": completion said as a state. "Complete the migration" is work,
// so a completion word counts only when nothing but punctuation or "as/in/via/at/by/and" follows it.
// "PR #633 is merged": the same state, said of the work as the clause's subject.
const NOTHING = new RegExp(
  [
    /^[^a-z0-9]*(?:none|nothing|n\/a|no (?:further|next|follow-?up|action|work))\b/,
    /^[^a-z0-9]*(?:all\s+|already\s+|work\s+(?:is\s+)?)?(?:done|complete[d]?|finished|merged|landed|shipped|closed|resolved)(?=\s*$|\s*[—–:.;,(!)]|\s+-\s|\s+(?:as|in|via|at|by|and)\b)/,
    /^[^a-z0-9#]*(?:(?:the|this|that)\s+)?(?:(?:PR|pull request|issue|work|lane|task|fix|change|branch|patch|slice|train)\s*)?(?:#\d+|[0-9a-f]{7,40}|it|everything|all)?\s*(?:is|was|are|were|has\s+been|have\s+been|got)\s+(?:now\s+|already\s+|fully\s+|all\s+)?(?:done|complete[d]?|finished|merged|landed|shipped|closed|resolved)\b/,
  ]
    .map((part) => part.source)
    .join("|"),
  "i",
);
const CLOSE_ONLY = /^[^a-z0-9]*close\b(?:\s+(?:#\d+|it|the issue))?(?:\s+as\s+\w+|\s+with evidence\b.*)?$/i;
const CONDITIONAL = /^[^a-z0-9]*(?:[a-z ]{1,30}:\s*)?(?:once|until|when|after)\b/i;
const OTHER_LANES = /^[^a-z0-9#]*#\d+(?:\s*(?:,|and|&|\/)\s*#\d+)*\s+(?:may|can|could|should)\b/i;
const AT_TIME = /\b(?:after|until|at|from)\s+\d{1,2}:\d{2}\s*Z?\b/i;
const OWNER_FIRST = /^[^a-z0-9]*(?:the\s+)?(?:owner|kuya)\b/i;
const OWNER_GATE =
  /\b(?:owner|kuya)(?:[-\s]only\b|[-\s]hands?\b|[-\s]gated\b|['’]s\s+(?:proof|decision|call|word|approval|sign-?off|test|hands?|review|go-?ahead|answer|ruling|reboot)\b|\s+(?:to|must|should|needs? to|has to)\s+\w+|\s+(?:applies|runs|decides|approves|proves|tests|merges|reviews|reboots|installs|confirms|signs)\b)|\b(?:awaits?|awaiting|pending|needs?|requires?|get|obtain|ask(?:ing)?\s+for|request|seek)\s+(?:(?:an?|the|explicit)\s+)*(?:owner|kuya)\b(?!-)|\b(?:approval|sign-?off|go-?ahead|decision|ruling|confirmation|answer|proof|permission|input)\s+(?:from|by|of)\s+(?:the\s+)?(?:owner|kuya)\b(?!-)|\b(?:owner|kuya)\s+(?:approval|sign-?off|go-?ahead|decision|ruling|confirmation|answer|proof|permission|input)\s+(?:is\s+|are\s+)?(?:still\s+)?(?:required|needed|pending|outstanding|missing)\b/i;
// "await" opening the clause is a wait; mid-clause only with a gate as its object ("wrap it in an
// await" is code).
const WAITS =
  /\b(?:wait(?:s|ing)?\s+(?:on|for|until)|blocked\s+(?:on|by|until|behind)|gated\s+(?:on|by|behind)|parked\s+(?:on|until|behind)|held\s+(?:on|until|behind)|depends\s+on)\b|^[^a-z0-9]*await(?:s|ing)?\b|\bawait(?:s|ing)?\s+(?:the\s+|an?\s+)?(?:#\d+|PR\b|codex|review|approval|merge|release|decision|proof|sign-?off|go-?ahead|lease|claim)/i;
const AFTER =
  /\b(?:after|once|when|until|before)\b[^.;\n]{0,60}?(?:#\d+|\bPR\s*#?\d+|\bowner\b|\bkuya\b)[^.;\n]{0,40}?\b(?:merg\w*|land\w*|releas\w*|clos\w*|approv\w*|proof|prov\w*|appl\w*|decid\w*|decision|test\w*|review\w*|ship\w*)\b/i;
// "If #611 is still open, …": the step is conditional on a gate that has not moved. "If PR #611 has
// merged, …" asks the same gate the positive way; "if the gate passes" is the successor's own gate.
const IF_GATE = new RegExp(
  [
    /^[^a-z0-9]*(?:if|unless)\b[^,.;\n]{0,60}?(?:#\d+|\bPR\s*#?\d+|\blease\b|\bclaim\b|\bgate\b)[^,.;\n]{0,40}?\b(?:still\s+(?:open|held|draft|blocked|red)|open|held|unmerged|(?:has\s+|is\s+|was\s+)?not\s+(?:yet\s+)?(?:merged|landed|released|closed|passed))\b/,
    /^[^a-z0-9]*(?:if|unless)\b[^,.;\n]{0,60}?(?:#\d+|\bPR\s*#?\d+|\blease\b|\bclaim\b)[^,.;\n]{0,40}?\b(?:merg|land|releas|clos|approv|free|expir)\w*/,
  ]
    .map((part) => part.source)
    .join("|"),
  "i",
);
const RECHECK = new RegExp(
  [
    /\bre-?check\w*\b|\bpoll\w*\b|\bcheck back\b/,
    // "Check whether PR #611 has merged", "Make sure #611 has merged": asking a gate, not moving it.
    /\b(?:check|see|confirm|verify|find out|make sure|ensure|report|ask|tell|note|determine|watch|monitor|track)(?:s|es|ed|ing)?\s+(?:(?:whether|if|that)\b|(?=(?:the\s+)?(?:PR\s*)?#\d+))[^.;\n]{0,60}?(?:#\d+|\bPR\b|\blease\b|\bclaim\b|\bgate\b|\bowner\b)[^.;\n]{0,40}?\b(?:merg|land|releas|clos|approv|open|held|free|mov|chang)\w*/,
  ]
    .map((part) => part.source)
    .join("|"),
  "i",
);

/** Why a Handoff's Exact next action gives a successor nothing to start now, or null when it does. */
function nextActionStop(nextAction) {
  const text = (nextAction ?? "").trim();
  if (!/[a-z0-9]/i.test(text)) return "its Handoff names no `Exact next action`, so a successor would have nothing to start";
  const first = text.split(CLAUSE_END)[0];
  if (NOTHING.test(first) || CLOSE_ONLY.test(first)) return "its Exact next action says nothing is left: the work is complete";
  if (OTHER_LANES.test(first)) return "its Exact next action is other issues' work, which their own lanes claim";
  if (OWNER_FIRST.test(first) || OWNER_GATE.test(first)) return "its Exact next action is the owner's, so the work is owner-gated";
  if (CONDITIONAL.test(first) || IF_GATE.test(first) || WAITS.test(first) || AFTER.test(first) || AT_TIME.test(first)) {
    return "its Exact next action waits on another issue, PR, the owner or a time, so the work is blocked";
  }
  if (RECHECK.test(first)) return "its Exact next action only rechecks or polls, which is observation, not work";
  return null;
}

/** `--handoff <file>` → its text; null when the flag is absent, the path missing, or the file unreadable. */
function readHandoffArg(argv) {
  const at = argv.indexOf("--handoff");
  if (at === -1 || !argv[at + 1]) return null;
  try {
    return readFileSync(argv[at + 1], "utf8").replace(/^\uFEFF/, "");
  } catch {
    return null;
  }
}

function main(argv) {
  const { route, routine, why } = pickRoute(readLauncherTasks({}));
  console.log(`route: ${route}`);
  console.log(`why: ${why}`);
  if (routine.length) console.log(`routine: ${routine.join(", ")}`);
  const built = successorPrompt(readHandoffArg(argv));
  if (!built.ok) {
    console.error(`prompt: refused — ${built.why}.`);
    process.exitCode = 1;
    return;
  }
  console.log("");
  console.log(built.prompt);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
