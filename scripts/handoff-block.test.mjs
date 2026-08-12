import { describe, it, expect } from "vitest";
import { checkHandoffBlock, lastAssistantText } from "./lib/handoff-block.mjs";

// Guard for the HANDOFF BLOCK law. See scripts/lib/handoff-block.mjs for why this is mechanized.
// The detector is deliberately strict about BOTH halves, so the tests below are mostly about
// proving it cannot be satisfied by half a block — that is the exact way the law kept failing.

describe("checkHandoffBlock", () => {
  it("accepts a block carrying both a disposition and a next action", () => {
    const msg = `**HANDOFF** — this session can be archived. Next session: finish the
      WebviewWindowBuilder fix in src-tauri/src/lib.rs.`;
    expect(checkHandoffBlock(msg)).toEqual({ ok: true, missing: [] });
  });

  it("rejects a done-report with no disposition — the original failure mode", () => {
    // This is (a compressed version of) the message the owner had to correct on 2026-08-11:
    // complete, accurate, verified, and useless for keeping his sidebar clean.
    const msg = "Done. Three merged, main is green. Nothing for you to do.";
    const { ok, missing } = checkHandoffBlock(msg);
    expect(ok).toBe(false);
    expect(missing).toEqual([
      "disposition (archive / delete / leave open)",
      "next action for the following session",
    ]);
  });

  it("rejects a disposition with no next action", () => {
    const { ok, missing } = checkHandoffBlock("This session is safe to delete.");
    expect(ok).toBe(false);
    expect(missing).toEqual(["next action for the following session"]);
  });

  it("rejects a next action with no disposition", () => {
    const { ok, missing } = checkHandoffBlock("Next session: rebuild and ship the installer.");
    expect(ok).toBe(false);
    expect(missing).toEqual(["disposition (archive / delete / leave open)"]);
  });

  it("is insensitive to wrapping and case, so reformatting cannot flip the verdict", () => {
    const wrapped = "HANDOFF\n\nLEAVE\n  OPEN.\n\nNEXT   SESSION: run the gate.";
    expect(checkHandoffBlock(wrapped).ok).toBe(true);
  });

  it("treats empty, null and undefined as a failure rather than throwing", () => {
    for (const value of ["", null, undefined]) {
      expect(checkHandoffBlock(value).ok).toBe(false);
    }
  });

  it("does not accept the bare word handoff as a next action substitute", () => {
    // "handoff" IS in the next-action vocabulary, so this proves the disposition half still bites.
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
