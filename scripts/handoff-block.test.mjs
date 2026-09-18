import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { checkHandoffBlock, checkSuccessorProof, lastAssistantText, turnLaunches } from "./lib/handoff-block.mjs";

// Guard for the HANDOFF BLOCK law. See scripts/lib/handoff-block.mjs for why this is mechanized.
//
// REWRITTEN 2026-09-17/18 (#466): the contract used to be tab verdict + next action + lane. It is
// now tab verdict + a `Successor:` line naming HOW the next session was already launched, checked
// against the turn's own tool calls. The tests below prove BOTH halves cannot be satisfied by
// half-truths: a Successor line with no answer behind it, or a claimed launch with no call behind it.

describe("checkHandoffBlock", () => {
  it("accepts a tab verdict plus a launched successor with a real answer", () => {
    const msg = `Safe to close. Successor: launched — the compy-successor-a routine picks up issue #466.`;
    expect(checkHandoffBlock(msg)).toEqual({
      ok: true,
      missing: [],
      successor: { kind: "launched", detail: "the compy-successor-a routine picks up issue #466" },
    });
  });

  it("accepts a chip successor", () => {
    const msg = "Safe to close. Successor: chip — a one-click chip is queued for the owner to start.";
    const { ok, successor } = checkHandoffBlock(msg);
    expect(ok).toBe(true);
    expect(successor.kind).toBe("chip");
  });

  it("accepts a none successor with a real reason", () => {
    const msg = "Safe to close. Successor: none — owner must flip the toggle before anything can run.";
    expect(checkHandoffBlock(msg)).toEqual({
      ok: true,
      missing: [],
      successor: { kind: "none", detail: "owner must flip the toggle before anything can run" },
    });
  });

  it("rejects a done-report with neither half — the original failure mode", () => {
    const msg = "Done. Three merged, main is green. Nothing for you to do.";
    const { ok, missing, successor } = checkHandoffBlock(msg);
    expect(ok).toBe(false);
    expect(missing).toEqual(["tab verdict", "successor line"]);
    expect(successor).toBeNull();
  });

  it('rejects "leave session open" — the tab-verdict half is unchanged by this rewrite', () => {
    const msg = "Leave session open. Successor: none — plan usage is at 82%, nothing more to launch.";
    const { ok, missing } = checkHandoffBlock(msg);
    expect(ok).toBe(false);
    expect(missing).toEqual(["tab verdict"]);
  });

  it("rejects keeping the tab open without a reason", () => {
    expect(checkHandoffBlock("Keep this tab open. Successor: none — nothing is queued.").ok).toBe(false);
    expect(
      checkHandoffBlock("Keep this tab open because PR #163 is mid-merge. Successor: none — nothing queued yet.")
        .ok,
    ).toBe(true);
  });

  it("FAILS a pasted old-style block (next action + lane + tab verdict) with no Successor line", () => {
    // Exactly the shape the pre-#466 contract accepted: a real tab verdict, a next-session
    // instruction, and a named lane — and nothing that says a successor was launched.
    const msg = `Safe to close. Same lane. Next session: finish the WebviewWindowBuilder fix in
      src-tauri/src/lib.rs.`;
    const { ok, missing, successor } = checkHandoffBlock(msg);
    expect(ok).toBe(false);
    expect(missing).toEqual(["successor line"]);
    expect(successor).toBeNull();
  });

  it("rejects a Successor: line with no separator/answer at all", () => {
    expect(checkHandoffBlock("Safe to close. Successor: launched").ok).toBe(false);
  });

  it("rejects NON_ANSWER details behind a valid kind word", () => {
    for (const bad of ["Successor: none — n/a.", "Successor: none — tbd.", "Successor: chip — unclear."]) {
      const { ok, missing } = checkHandoffBlock(`Safe to close. ${bad}`);
      expect(ok, `"${bad}" must not satisfy the successor half`).toBe(false);
      expect(missing).toEqual(["successor line"]);
    }
  });

  it("rejects an answer under two words", () => {
    expect(checkHandoffBlock("Safe to close. Successor: none — later.").ok).toBe(false);
  });

  it("does not let an empty-ish Successor: annex the field after it", () => {
    // Same #270 lesson the old LANE_LABEL protected against, retargeted: flattening collapses the
    // newline, so a hollow successor line must not borrow the next label's answer as its own.
    const msg = "Safe to close.\nSuccessor:\nNext session: rebuild the installer and ship it.";
    const { ok, missing } = checkHandoffBlock(msg);
    expect(ok).toBe(false);
    expect(missing).toEqual(["successor line"]);
  });

  it("uses the LAST Successor: line when several are present — later corrects earlier", () => {
    const upgraded =
      "Safe to close. Successor: chip — a chip is queued. Successor: launched — the compy-successor-a routine actually ran.";
    const { ok, successor } = checkHandoffBlock(upgraded);
    expect(ok).toBe(true);
    expect(successor.kind).toBe("launched");

    const downgraded =
      "Safe to close. Successor: launched — the routine ran fine just now. Successor: none — n/a.";
    const { ok: ok2, missing } = checkHandoffBlock(downgraded);
    expect(ok2).toBe(false);
    expect(missing).toEqual(["successor line"]);
  });

  it("accepts a markdown-bold labelled Successor line", () => {
    const msg = "**Safe to close.** **Successor:** launched — the compy-successor-a routine picks up the branch.";
    const { ok, successor } = checkHandoffBlock(msg);
    expect(ok).toBe(true);
    expect(successor.kind).toBe("launched");
  });

  it("is insensitive to wrapping and case, so reformatting cannot flip the verdict", () => {
    const wrapped =
      "SAFE   TO\n  CLOSE.\n\nSUCCESSOR:   NONE — nothing is\n  ordered or queued right now.";
    expect(checkHandoffBlock(wrapped).ok).toBe(true);
  });

  it("treats empty, null and undefined as a failure rather than throwing", () => {
    for (const value of ["", null, undefined]) {
      const { ok, successor } = checkHandoffBlock(value);
      expect(ok).toBe(false);
      expect(successor).toBeNull();
    }
  });
});

describe("turnLaunches", () => {
  const line = (obj) => JSON.stringify(obj) + "\n";
  const ownerMsg = (text = "keep going") => line({ type: "user", message: { role: "user", content: text } });
  const toolUse = (id, name) =>
    line({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input: {} }] } });
  const toolResult = (id, text, isError) =>
    line({
      type: "user",
      message: {
        role: "user",
        content: [{ tool_use_id: id, type: "tool_result", content: [{ type: "text", text }], is_error: isError }],
      },
    });

  it("counts a successful run_scheduled_task as launched", () => {
    const tail =
      ownerMsg() +
      toolUse("t1", "mcp__scheduled-tasks__run_scheduled_task") +
      toolResult("t1", 'Scheduled task "compy-successor-a" dispatched as session local_abc123.');
    expect(turnLaunches(tail)).toEqual({ launched: 1, chip: 0 });
  });

  it("does not count a refused (is_error) run_scheduled_task call", () => {
    const tail =
      ownerMsg() +
      toolUse("t1", "mcp__scheduled-tasks__run_scheduled_task") +
      toolResult("t1", "refused: already running", true);
    expect(turnLaunches(tail)).toEqual({ launched: 0, chip: 0 });
  });

  it("does not count a run_scheduled_task result that never says dispatched", () => {
    const tail =
      ownerMsg() + toolUse("t1", "mcp__scheduled-tasks__run_scheduled_task") + toolResult("t1", "queued, not yet dispatched");
    expect(turnLaunches(tail)).toEqual({ launched: 0, chip: 0 });
  });

  it("counts a successful spawn_task as chip, separately from launched", () => {
    const tail =
      ownerMsg() +
      toolUse("t1", "mcp__ccd_session__spawn_task") +
      toolResult("t1", "Noted (position 1, task_id: task_cc0d16be). A chip is showing for the user ...");
    expect(turnLaunches(tail)).toEqual({ launched: 0, chip: 1 });
  });

  it("counts start_session / hand_off_to_session as launched on bare non-error success", () => {
    const tail =
      ownerMsg() +
      toolUse("t1", "mcp__ccd_session__start_session") +
      toolResult("t1", "ok") +
      toolUse("t2", "mcp__ccd_session__hand_off_to_session") +
      toolResult("t2", "ok");
    expect(turnLaunches(tail)).toEqual({ launched: 2, chip: 0 });
  });

  it("does not count a launch from BEFORE the last genuine owner message", () => {
    const stale =
      toolUse("t1", "mcp__scheduled-tasks__run_scheduled_task") +
      toolResult("t1", 'Scheduled task "compy-successor-a" dispatched as session local_stale.') +
      ownerMsg("do more work");
    expect(turnLaunches(stale)).toEqual({ launched: 0, chip: 0 });
  });

  it("is not reset by Stop-hook feedback, isMeta, compact-summary or tool_result user entries", () => {
    const real = ownerMsg("do the next thing");
    const decoys =
      line({ type: "user", isMeta: true, message: { role: "user", content: "Stop hook feedback: blocked" } }) +
      line({ type: "user", isMeta: true, message: { role: "user", content: "some other meta note" } }) +
      line({ type: "user", isCompactSummary: true, message: { role: "user", content: "compacted summary text" } }) +
      toolUse("d1", "Bash") +
      toolResult("d1", "irrelevant tool output");
    const launch =
      toolUse("t1", "mcp__scheduled-tasks__run_scheduled_task") +
      toolResult("t1", 'Scheduled task "compy-successor-a" dispatched as session local_ok.');
    expect(turnLaunches(real + decoys + launch)).toEqual({ launched: 1, chip: 0 });
  });

  // #466 review, belt and braces: the harness usually marks a re-injected Stop-hook reason isMeta,
  // but that is not guaranteed — the content prefix alone must be enough to exclude it from being
  // mistaken for a genuine owner turn, or a launch made before a hook-triggered continuation goes
  // uncounted because the scan boundary lands too late.
  it("is not reset by Stop-hook feedback even when isMeta is missing on that entry", () => {
    const real = ownerMsg("do the next thing");
    const launch =
      toolUse("t1", "mcp__scheduled-tasks__run_scheduled_task") +
      toolResult("t1", 'Scheduled task "compy-successor-a" dispatched as session local_ok.');
    const feedbackNoIsMeta = line({
      type: "user",
      message: { role: "user", content: "Stop hook feedback: HANDOFF INCOMPLETE — missing: tab verdict" },
    });
    expect(turnLaunches(real + launch + feedbackNoIsMeta)).toEqual({ launched: 1, chip: 0 });
  });

  it("matches a launch tool by SUFFIX regardless of server prefix — the server segment is unverified", () => {
    const tail =
      ownerMsg() +
      toolUse("t1", "mcp__other__run_scheduled_task") +
      toolResult("t1", 'Scheduled task "compy-successor-a" dispatched as session local_x.');
    expect(turnLaunches(tail)).toEqual({ launched: 1, chip: 0 });
  });

  it("skips a truncated leading line instead of throwing", () => {
    const tail =
      '{"type":"assis' +
      "\n" +
      ownerMsg() +
      toolUse("t1", "mcp__scheduled-tasks__run_scheduled_task") +
      toolResult("t1", 'Scheduled task "compy-successor-a" dispatched as session local_abc.');
    expect(turnLaunches(tail)).toEqual({ launched: 1, chip: 0 });
  });

  it("skips isSidechain entries", () => {
    const tail =
      ownerMsg() +
      line({
        type: "assistant",
        isSidechain: true,
        message: { content: [{ type: "tool_use", id: "t1", name: "mcp__scheduled-tasks__run_scheduled_task", input: {} }] },
      }) +
      line({
        type: "user",
        isSidechain: true,
        message: { role: "user", content: [{ tool_use_id: "t1", type: "tool_result", content: [{ type: "text", text: "dispatched as session x" }] }] },
      });
    expect(turnLaunches(tail)).toEqual({ launched: 0, chip: 0 });
  });

  it("returns zero counts on an empty or garbage tail", () => {
    expect(turnLaunches("")).toEqual({ launched: 0, chip: 0 });
    expect(turnLaunches("not json\nalso not json")).toEqual({ launched: 0, chip: 0 });
  });
});

describe("checkSuccessorProof", () => {
  it("flags launched proof missing when nothing was launched", () => {
    const { ok, missing } = checkSuccessorProof({ kind: "launched", detail: "x y" }, { launched: 0, chip: 0 });
    expect(ok).toBe(false);
    expect(missing).toEqual(["launched proof"]);
  });

  it("flags chip proof missing when no chip call happened", () => {
    const { ok, missing } = checkSuccessorProof({ kind: "chip", detail: "x y" }, { launched: 0, chip: 0 });
    expect(ok).toBe(false);
    expect(missing).toEqual(["chip proof"]);
  });

  it("passes launched when a launch call was actually made", () => {
    expect(checkSuccessorProof({ kind: "launched", detail: "x y" }, { launched: 1, chip: 0 })).toEqual({
      ok: true,
      missing: [],
    });
  });

  it("passes chip when a chip call was actually made", () => {
    expect(checkSuccessorProof({ kind: "chip", detail: "x y" }, { launched: 0, chip: 1 })).toEqual({
      ok: true,
      missing: [],
    });
  });

  it("needs no proof for kind none, or a null successor", () => {
    expect(checkSuccessorProof({ kind: "none", detail: "x y" }, { launched: 0, chip: 0 })).toEqual({
      ok: true,
      missing: [],
    });
    expect(checkSuccessorProof(null, { launched: 0, chip: 0 })).toEqual({ ok: true, missing: [] });
  });
});

// ── the hook must ask only for what is absent (#270), retargeted at the new contract ────────────
describe("handoff-block-guard remediation", () => {
  // Resolved the way tools/entry/session-root-assert.test.mjs does it: under vitest's transform
  // `import.meta.url` is not a file: URL, so `new URL(..., import.meta.url)` throws before any
  // assertion runs and the whole suite reports zero tests.
  const HERE = dirname(fileURLToPath(import.meta.url));
  const HOOK_SOURCE_PATH = join(HERE, "..", ".claude", "hooks", "handoff-block-guard.mjs");
  const HOOK = readFileSync(HOOK_SOURCE_PATH, "utf8");

  it("renders its bullets from missing[] rather than a fixed template", () => {
    expect(HOOK).toMatch(/missing\.map\(/);
  });

  it("tells the model not to open a second heading", () => {
    expect(HOOK).toMatch(/do not write a second/i);
  });

  it("carries a bullet for every half checkHandoffBlock or checkSuccessorProof can report missing", () => {
    const { missing } = checkHandoffBlock("");
    expect(missing).toEqual(["tab verdict", "successor line"]);
    const proofKeys = [
      checkSuccessorProof({ kind: "launched", detail: "x y" }, { launched: 0, chip: 0 }).missing[0],
      checkSuccessorProof({ kind: "chip", detail: "x y" }, { launched: 0, chip: 0 }).missing[0],
    ];
    for (const half of [...missing, ...proofKeys]) {
      expect(HOOK, `no bullet for "${half}"`).toContain(half);
    }
  });

  // #466 review: the successor bullet must spell out the concrete tool (not just say "launch it"),
  // the two escape hatches (this lane's own next step, or nothing ordered), and the numeric plan-usage
  // threshold — vague wording here is exactly how a model justifies "none" without evidence.
  it("names the concrete route script and the owner-bound/80%/never-paste conditions in the successor bullet", () => {
    expect(HOOK).toContain("successor-route.mjs");
    expect(HOOK).toContain("owner-bound");
    expect(HOOK).toContain("80%");
    expect(HOOK).toContain("never paste");
  });

  // ── end-to-end: drive the real hook process against a synthetic transcript ─────────────────────
  const jline = (obj) => JSON.stringify(obj) + "\n";
  const ownerMsg = () => jline({ type: "user", message: { role: "user", content: "keep going" } });
  const finalReply = (text) => jline({ type: "assistant", message: { content: [{ type: "text", text }] } });

  function writeTranscript(entries) {
    const dir = mkdtempSync(join(tmpdir(), "handoff-guard-e2e-"));
    const tp = join(dir, "transcript.jsonl");
    writeFileSync(tp, entries.join(""));
    return tp;
  }

  function runHook(tp, extra = {}) {
    const res = spawnSync(process.execPath, [HOOK_SOURCE_PATH], {
      input: JSON.stringify({ transcript_path: tp, stop_hook_active: false, ...extra }),
      encoding: "utf8",
    });
    expect(res.error).toBeUndefined();
    return res;
  }

  it("blocks a claimed launch with no launch call behind it", () => {
    const tp = writeTranscript([
      ownerMsg(),
      finalReply("Safe to close. Successor: launched — the compy-successor-a routine picks up next."),
    ]);
    const res = runHook(tp);
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).not.toBe("");
    const out = JSON.parse(res.stdout);
    expect(out.decision).toBe("block");
    expect(out.reason).toContain("launched proof");
  });

  it("does not block when a successful run_scheduled_task call backs the claim", () => {
    const tp = writeTranscript([
      ownerMsg(),
      jline({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "toolu_1", name: "mcp__scheduled-tasks__run_scheduled_task", input: {} },
          ],
        },
      }),
      jline({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              tool_use_id: "toolu_1",
              type: "tool_result",
              content: [{ type: "text", text: 'Scheduled task "compy-successor-a" dispatched as session local_abc.' }],
            },
          ],
        },
      }),
      finalReply("Safe to close. Successor: launched — the compy-successor-a routine picks up next."),
    ]);
    const res = runHook(tp);
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe("");
  });

  it("never blocks when stop_hook_active is true, regardless of content", () => {
    const tp = writeTranscript([
      ownerMsg(),
      finalReply("Successor: launched — nothing behind this claim at all."),
    ]);
    const res = runHook(tp, { stop_hook_active: true });
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe("");
  });
});

describe("lastAssistantText", () => {
  const line = (obj) => JSON.stringify(obj) + "\n";
  const assistant = (text, extra = {}) => line({ type: "assistant", message: { content: [{ type: "text", text }] }, ...extra });

  it("returns the most recent assistant text", () => {
    const tail = assistant("older") + line({ type: "user" }) + assistant("newest");
    expect(lastAssistantText(tail)).toBe("newest");
  });

  it("skips sidechain (subagent) turns — a subagent's report is not the owner-facing message", () => {
    const tail = assistant("real answer") + assistant("subagent chatter", { isSidechain: true });
    expect(lastAssistantText(tail)).toBe("real answer");
  });

  it("walks back past tool-only turns that carry no text block", () => {
    const toolOnly = line({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash" }] } });
    expect(lastAssistantText(assistant("the words") + toolOnly)).toBe("the words");
  });

  it("survives a truncated leading line, since the tail is read from a byte offset", () => {
    expect(lastAssistantText('{"type":"assis' + "\n" + assistant("intact"))).toBe("intact");
  });

  it("returns null when there is no assistant text at all", () => {
    expect(lastAssistantText(line({ type: "user" }))).toBeNull();
    expect(lastAssistantText("")).toBeNull();
  });
});
