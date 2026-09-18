#!/usr/bin/env node
// Stop hook — HANDOFF BLOCK guard (2026-08-11).
//
// WHY THIS EXISTS. CLAUDE.md has carried "End every session with a HANDOFF BLOCK — a paste-ready
// prompt for the next session, plus one line saying whether this session is done (archive / delete /
// leave open)" for months, and the owner has still had to ask for it by hand more than once. His
// framing on 2026-08-11: without the disposition line he cannot keep the sidebar clean, so finished
// work and live work look identical and real work gets buried. He keeps no notes; this line IS his
// index. Under the standing toolchain-over-prose law, a rule missed that often gets a guard, and
// under bug->guard the guard lands before the fix counts.
//
// UPDATE (2026-09-17/18, #466). The owner's next order: stop pasting a prompt for HIM to carry into
// a new tab — launch the next session yourself. The contract is now a tab verdict plus a `Successor:
// launched|chip|none — <reason>` line, and a "launched"/"chip" claim is checked against the turn's
// OWN tool calls (lib.turnLaunches / lib.checkSuccessorProof) — saying "launched" with no
// run_scheduled_task (or equivalent) call behind it is the same half-truth #270 already covers for a
// hollow label, aimed at a claim instead of an empty field.
//
// COST SHAPE. This blocks at most ONCE per turn, and only when the final message is actually
// missing a half. A compliant turn never sees it and pays nothing — the correct shape for a guard
// whose job is to become invisible.
//
// The judgement (what counts as a handoff) lives in scripts/lib/handoff-block.mjs so it can be
// unit-tested without a transcript; scripts/handoff-block.test.mjs pins it. This file is plumbing.
//
// Safety guards, matching the other Stop hooks here:
//   - stop_hook_active -> always allow (never loop).
//   - any parse/read/import failure -> silent exit. A guard must never be the reason a turn cannot
//     end; that is the big-read-guard v1 failure mode (dead on a swallowed error) inverted.

import { readFileSync, openSync, readSync, closeSync, statSync } from "node:fs";

const TAIL_BYTES = 512 * 1024;

let lib = null;
try {
  lib = await import(new URL("../../scripts/lib/handoff-block.mjs", import.meta.url));
} catch {
  process.exit(0); // no detector -> no opinion
}

let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  process.exit(0);
}

if (input.stop_hook_active === true) process.exit(0);

const tp = input?.transcript_path;
if (!tp) process.exit(0);

let tail = "";
try {
  const size = statSync(tp).size;
  const fd = openSync(tp, "r");
  const start = Math.max(0, size - TAIL_BYTES);
  const buf = Buffer.alloc(size - start);
  readSync(fd, buf, 0, buf.length, start);
  closeSync(fd);
  tail = buf.toString("utf8");
} catch {
  process.exit(0);
}

const text = lib.lastAssistantText(tail);
if (text === null) process.exit(0); // nothing owner-facing was said; nothing to check

const { missing: textMissing, successor } = lib.checkHandoffBlock(text);
const missing = [...textMissing];

// A well-formed Successor: line is only half the claim — the other half is that the turn actually
// made the call it describes. Only checked once the line itself parses, so a malformed line reports
// as "successor line" (fix the sentence) rather than "launched proof" (a confusing ask when there is
// no parseable claim yet to hold proof against).
if (successor?.kind === "launched" || successor?.kind === "chip") {
  const launches = lib.turnLaunches(tail);
  const proof = lib.checkSuccessorProof(successor, launches);
  missing.push(...proof.missing);
}

if (missing.length === 0) process.exit(0);

// ONE BULLET PER ACTUALLY-MISSING HALF (#270). This used to print all four every time, regardless
// of what `missing` held, under the instruction "Append a short block". So a reply that already
// carried a real tab verdict and a real next action, and only lacked a lane, was answered with a
// whole fresh block repeating the two halves that were already fine — and the owner saw TWO
// handoffs. His words: "quite literally redundant". A Stop hook can only ever append to a message
// already sent, so the block it asks for must be exactly the part that is absent and nothing else.
const BULLET = {
  "tab verdict":
    `- This tab: "safe to close" OR "keep this tab open because <reason>". Say it about the VS Code ` +
    `tab in front of him, not about the session — "leave session open" is not a verdict he can act on.`,
  "successor line":
    `- Successor: launch the next session yourself before this reply ends; never paste a prompt for ` +
    `him to carry. If the next step is this lane's own, keep working instead of stopping. Otherwise ` +
    `run \`node scripts/successor-route.mjs\` and follow it: a launcher routine (update_scheduled_task ` +
    `with the preamble plus the task, then run_scheduled_task), or a spawn_task chip. Then write ` +
    `"Successor: launched — <what runs>", "Successor: chip — <what it starts>" or "Successor: none — ` +
    `<why>". "none" fits only when the next step is owner-bound, plan usage (get_usage) is at or above ` +
    `80%, or nothing is ordered or queued.`,
  "launched proof":
    `- Your reply claims "Successor: launched" but this turn shows no successful ` +
    `run_scheduled_task/start_session/hand_off_to_session call. Either make that call now and keep ` +
    `the "launched" line, or change the line to what actually happened.`,
  "chip proof":
    `- Your reply claims "Successor: chip" but this turn shows no successful spawn_task call. Either ` +
    `make that call now and keep the "chip" line, or change the line to what actually happened.`,
};

const bullets = missing.map((m) => BULLET[m]).filter(Boolean).join("\n");

process.stdout.write(
  JSON.stringify({
    decision: "block",
    reason:
      `HANDOFF INCOMPLETE — your reply is missing: ${missing.join("; ")}. ` +
      `The owner keeps no notes and reads his sidebar as the index of what is finished versus ` +
      `live, so a reply without this leaves a session he cannot classify and real work gets ` +
      `buried. Do NOT redo or re-verify any work, and do NOT repeat the report you just gave.\n\n` +
      `Add ONLY the missing line(s) below. Do NOT write a second "**Handoff**" heading and do NOT ` +
      `restate the parts you already got right — whatever else your reply said still stands:\n` +
      bullets,
  }) + "\n",
);
process.exit(0);
