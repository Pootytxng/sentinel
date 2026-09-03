#!/usr/bin/env node
// PreToolUse(Bash|PowerShell) hook — work-control receipt guard (2026-08-20).
//
// NOT WIRED BY DEFAULT. The owner installs this by hand — his settings carry
// `hard_deny: "…any hook that gates the assistant's own authority — the owner applies those by
// hand"`, and this is exactly that. The settings block to paste is at the bottom of this file.
//
// WHY IT EXISTS. `docs/WORK_CONTROL.md` + `CLAUDE.md` require `scripts/work-control-gate.mjs` to
// authorize any PROOF-DEPENDENT GitHub state transition — `merge-pr`, `close-issue`, `mark-done`,
// `mark-pr-ready`, `close-superseded-pr`. On 2026-08-20 a session (this one) merged PR #157 and
// closed #155 without producing a receipt at all. The work was real and verified — full suite,
// pre-push gate, self-review PASS — which is precisely the failure mode worth guarding: the gate
// gets skipped on the runs that feel obviously fine, so it never catches the run that isn't.
//
// Under the standing toolchain-over-prose law, a rule broken by the session that had just re-read
// it does not need another paragraph. It needs this.
//
// WHAT IT DOES. Inspects the command about to run. If it performs a proof-dependent transition
// (`gh pr merge`, `gh issue close`, `gh pr ready`) it looks for a receipt written this session under
// .claude/work-control/ and matching the CURRENT repo head. No receipt, or a receipt bound to a
// different head → deny with the exact command to produce one. Anything else → silent allow.
//
// FAILURE POSTURE, matching every other hook here: any read/parse error is a SILENT ALLOW. A guard
// must never be the reason work cannot proceed — that is the big-read-guard v1 failure mode
// (dead on a swallowed error) inverted into a hard block.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const PROOF_DEPENDENT = [
  { re: /\bgh\s+pr\s+merge\b/, transition: "merge-pr" },
  // scripts/land-pr.mjs runs `gh pr merge` from inside node (P0-H case 10, #362); the command line
  // names the script, not gh, so it is matched here or the guard has a hole exactly one wrapper wide.
  { re: /\bland-pr\.mjs\b/, transition: "merge-pr" },
  { re: /\bgh\s+issue\s+close\b/, transition: "close-issue" },
  { re: /\bgh\s+pr\s+ready\b/, transition: "mark-pr-ready" },
];

function allow() {
  process.exit(0);
}

function deny(reason) {
  // PreToolUse deny contract: exit 2 with the reason on stderr.
  process.stderr.write(reason);
  process.exit(2);
}

let input = "";
try {
  input = readFileSync(0, "utf8");
} catch {
  allow();
}

let payload;
try {
  payload = JSON.parse(input);
} catch {
  allow();
}

const command = payload?.tool_input?.command ?? "";
if (typeof command !== "string" || !command) allow();

const hit = PROOF_DEPENDENT.find((p) => p.re.test(command));
if (!hit) allow();

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const receiptDir = join(projectDir, ".claude", "work-control");

let head = null;
try {
  head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectDir, encoding: "utf8" }).trim();
} catch {
  allow(); // no git answer → cannot judge → do not block
}

let receipts = [];
try {
  receipts = existsSync(receiptDir)
    ? readdirSync(receiptDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => {
          try {
            return JSON.parse(readFileSync(join(receiptDir, f), "utf8"));
          } catch {
            return null;
          }
        })
        .filter(Boolean)
    : [];
} catch {
  allow();
}

const matching = receipts.find((r) => r?.transition === hit.transition && r?.currentHead === head);
if (matching) allow();

deny(
  `work-control: "${hit.transition}" is a PROOF-DEPENDENT transition and no authorizing receipt ` +
    `exists for head ${head?.slice(0, 8)}.\n\n` +
    `docs/WORK_CONTROL.md requires the claim + inspection record BEFORE the GitHub state moves — ` +
    `repository, remoteState, worktree, branch, dirtyState. This guard exists because PR #157 was ` +
    `merged on 2026-08-20 with none of it, on a run that felt obviously fine.\n\n` +
    `Write the receipt to .claude/work-control/<name>.json, then:\n` +
    `  node scripts/work-control-gate.mjs .claude/work-control/<name>.json\n` +
    `and re-run this command once it authorizes.\n`,
);

// ── SETTINGS BLOCK TO INSTALL (owner applies by hand, into .claude/settings.json → hooks) ─────
//
// Add to the "PreToolUse" array:
//
//   {
//     "matcher": "Bash|PowerShell",
//     "hooks": [
//       {
//         "type": "command",
//         "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/work-control-receipt-guard.mjs\"",
//         "timeout": 10,
//         "statusMessage": "work-control receipt guard"
//       }
//     ]
//   }
