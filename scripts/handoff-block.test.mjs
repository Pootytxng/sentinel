import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

  // ── #270: a labelled lane answered in plain English ────────────────────────────────────────────
  // The owner saw TWO handoff blocks and said so. Cause: LANE was a closed phrase list, so a block
  // that answered every question was told it had named no lane, and the hook then asked for another.

  it("accepts a labelled Lane: answered in the writer's own words — the block that was rejected", () => {
    // Verbatim (minus formatting) the block the guard refused on 2026-08-30.
    const msg = `**HANDOFF**
      - **This tab:** safe to close. Nothing running, repo clean at 922c1c81, in sync with origin.
      - **Lane:** machine hygiene — done, no worktree claimed, nothing to merge.
      - **Next session:** docs/BACKLOG.md, next non-gated [ ] item.`;
    expect(checkHandoffBlock(msg)).toEqual({ ok: true, missing: [] });
  });

  it("accepts other plainly-worded lanes that the fixed phrase list could never match", () => {
    const lanes = [
      "Lane: docs hygiene, standalone, not tied to any open work.",
      "Lane: continuing the receipts-gate work from earlier today.",
      "Lane: worktree cleanup, local git only.",
    ];
    for (const lane of lanes) {
      expect(checkHandoffBlock(`Safe to close. ${lane} Next session: run the gate.`).ok).toBe(true);
    }
  });

  it("still rejects a Lane: label with nothing behind it — a named field is not an answer", () => {
    // The 2026-08-20 "leave session open" lesson, applied to this half: naming the field and
    // leaving it hollow is the same non-verdict in a different coat. Loosening LANE must not
    // reintroduce the ambiguity the guard exists to catch.
    for (const hollow of ["Lane:", "Lane: n/a", "Lane: TBD", "Lane: —", "Lane: see above", "Lane: unclear"]) {
      const { ok, missing } = checkHandoffBlock(`Safe to close. ${hollow} Next session: rebuild.`);
      expect(ok, `"${hollow}" must not satisfy the lane half`).toBe(false);
      expect(missing).toEqual(["which lane that next action is on (same lane / a new lane / name it)"]);
    }
  });

  it("does not let an empty Lane: annex the answer of the field after it", () => {
    // Caught by the case above on the first run of this fix. Flattening collapses the newline, so
    // "Lane:\nNext session: rebuild the installer" reads as one string and the hollow label would
    // otherwise pass on the strength of the NEXT field's answer.
    const msg = "Safe to close.\nLane:\nNext session: rebuild the installer and ship it.";
    const { ok, missing } = checkHandoffBlock(msg);
    expect(ok).toBe(false);
    expect(missing).toEqual(["which lane that next action is on (same lane / a new lane / name it)"]);
  });

  it("does not let the word lane elsewhere in a reply stand in for the lane half", () => {
    // A naive "contains lane" check would pass this. It names no lane for the NEXT action.
    const msg = "Safe to close. I fixed the lane detection regex. Next session: rebuild and ship.";
    expect(checkHandoffBlock(msg).ok).toBe(false);
  });
});

// ── #270, second half: the hook must ask only for what is absent ─────────────────────────────────
// The detector being wrong is why the guard fired; the hook's template is why the owner saw a
// DUPLICATE. It used to print all four bullets under "Append a short block" no matter what `missing`
// held, so even a correct block that lacked one half got a whole second block repeating the rest.
describe("handoff-block-guard remediation", () => {
  // Resolved the way tools/entry/session-root-assert.test.mjs does it: under vitest's transform
  // `import.meta.url` is not a file: URL, so `new URL(..., import.meta.url)` throws before any
  // assertion runs and the whole suite reports zero tests.
  const HERE = dirname(fileURLToPath(import.meta.url));
  const HOOK = readFileSync(join(HERE, "..", ".claude", "hooks", "handoff-block-guard.mjs"), "utf8");

  it("renders its bullets from missing[] rather than a fixed template", () => {
    expect(HOOK).toMatch(/missing\.map\(/);
  });

  it("tells the model not to open a second Handoff block", () => {
    expect(HOOK).toMatch(/do not write a second/i);
  });

  it("carries a bullet for every half checkHandoffBlock can report missing", () => {
    // Without this, renaming a string in handoff-block.mjs makes BULLET[m] undefined and the
    // instruction for that half silently disappears — a guard that asks for nothing.
    const { missing } = checkHandoffBlock("");
    expect(missing.length).toBe(3);
    for (const half of missing) {
      expect(HOOK, `no bullet for "${half}"`).toContain(half);
    }
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
