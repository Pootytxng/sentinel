import { describe, it, expect } from "vitest";
import { checkHandoffBlock, lastAssistantText } from "./lib/handoff-block.mjs";

// Guard for the HANDOFF BLOCK law. See scripts/lib/handoff-block.mjs for why this is mechanized.
// The detector is deliberately strict about BOTH halves, so the tests below are mostly about
// proving it cannot be satisfied by half a block — that is the exact way the law kept failing.

describe("checkHandoffBlock", () => {
  it("accepts a block carrying a tab verdict, a lane and a next action", () => {
    const msg = `**HANDOFF** — this tab is safe to close. Same lane. Next session: finish the
      WebviewWindowBuilder fix in src-tauri/src/lib.rs.`;
    expect(checkHandoffBlock(msg)).toEqual({ ok: true, missing: [] });
  });

  it("rejects a done-report with none of the three — the original failure mode", () => {
    // This is (a compressed version of) the message the owner had to correct on 2026-08-11:
    // complete, accurate, verified, and useless for keeping his sidebar clean.
    const msg = "Done. Three merged, main is green. Nothing for you to do.";
    const { ok, missing } = checkHandoffBlock(msg);
    expect(ok).toBe(false);
    expect(missing).toEqual([
      'tab verdict ("safe to close" / "keep this tab open because ...")',
      "next action for the following session",
      "which lane that next action is on (same lane / a new lane / name it)",
    ]);
  });

  it('rejects "leave session open" — the wording the owner could not act on', () => {
    // 2026-08-20, his words: it never said "how im supposed to know when to actually close the tab
    // in vscode". It described the model's state, so it must not satisfy the tab verdict.
    const msg = "**HANDOFF** — leave session open. Next session: run the gate on the same lane.";
    const { ok, missing } = checkHandoffBlock(msg);
    expect(ok).toBe(false);
    expect(missing).toEqual(['tab verdict ("safe to close" / "keep this tab open because ...")']);
  });

  it("rejects keeping the tab open without a reason — a hold he cannot evaluate is not a verdict", () => {
    const msg = "Keep this tab open. Next session: re-run the gate on lane/cleanup-train.";
    expect(checkHandoffBlock(msg).ok).toBe(false);
    expect(checkHandoffBlock("Keep this tab open because PR #163 is mid-merge. Next session: merge it.").ok).toBe(true);
  });

  it("rejects a verdict and lane with no next action", () => {
    const { ok, missing } = checkHandoffBlock("This tab is safe to close. Same lane.");
    expect(ok).toBe(false);
    expect(missing).toEqual(["next action for the following session"]);
  });

  it("rejects a next action with no tab verdict", () => {
    const { ok, missing } = checkHandoffBlock("Next session: ship the installer on the same lane.");
    expect(ok).toBe(false);
    expect(missing).toEqual(['tab verdict ("safe to close" / "keep this tab open because ...")']);
  });

  it("rejects a verdict and next action that never say which lane", () => {
    const { ok, missing } = checkHandoffBlock("Safe to close. Next session: rebuild and ship.");
    expect(ok).toBe(false);
    expect(missing).toEqual(["which lane that next action is on (same lane / a new lane / name it)"]);
  });

  it("is insensitive to wrapping and case, so reformatting cannot flip the verdict", () => {
    const wrapped = "HANDOFF\n\nSAFE   TO\n  CLOSE.\n\nNEXT   SESSION: run the gate on THIS LANE.";
    expect(checkHandoffBlock(wrapped).ok).toBe(true);
  });

  it("treats empty, null and undefined as a failure rather than throwing", () => {
    for (const value of ["", null, undefined]) {
      expect(checkHandoffBlock(value).ok).toBe(false);
    }
  });

  it("does not accept the bare word handoff as a next action substitute", () => {
    // "handoff" IS in the next-action vocabulary, so this proves the other two halves still bite.
    expect(checkHandoffBlock("Handoff below.").ok).toBe(false);
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
