// .claude/hooks/workflow-usage-guard.mjs is advisory: it must ALLOW every Workflow call and say its
// reminder through additionalContext (permissionDecisionReason is not delivered on an allow). The
// reminder's wording follows .claude/USAGE_ECONOMICS.md "Owner directive 2026-10-21": the weekly
// budget is a resource for verified outcomes, never a target on its own (owner ruling relayed in the
// PR #679 exact-head review). Hook files are owner-applied (#368), so the whole rewording (the earlier
// text called the Workflow tool "the biggest named token sink" and told sessions to work solo) travels
// as docs/superpowers/specs/2026-10-21-workflow-usage-guard-wording.patch; the pins that need the new
// wording skip until the hook source carries it.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = join(ROOT, ".claude", "hooks", "workflow-usage-guard.mjs");
const WORDED = readFileSync(HOOK, "utf8").includes("verified outcomes");

function run(toolInput) {
  const input = JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Workflow", tool_input: toolInput });
  const out = execFileSync(process.execPath, [HOOK], { input, encoding: "utf8" });
  return JSON.parse(out).hookSpecificOutput;
}

describe("PreToolUse(Workflow): the usage guard reminds, never blocks", () => {
  it("allows an inline script and names it in the reminder", () => {
    const o = run({ script: "export const meta = {}" });
    expect(o.permissionDecision).toBe("allow");
    expect(o.additionalContext).toMatch(/an inline script/);
    expect(o.additionalContext).toMatch(/USAGE_ECONOMICS\.md/);
    expect(o.additionalContext).toMatch(/a check, not a block/);
  });
  it("allows a named workflow and names it", () => {
    const o = run({ name: "review-changes" });
    expect(o.permissionDecision).toBe("allow");
    expect(o.additionalContext).toMatch(/named workflow "review-changes"/);
  });
  it.skipIf(!WORDED)("asks for bounded scope and logged drops instead of telling the session to work solo (owner patch)", () => {
    const o = run({ scriptPath: "x.mjs" });
    expect(o.additionalContext).toMatch(/Owner directive 2026-10-21/);
    expect(o.additionalContext).toMatch(/bounded/);
    expect(o.additionalContext).not.toMatch(/biggest named token sink|work solo/);
  });
  it.skipIf(!WORDED)("says the budget is for verified outcomes and never a target on its own (owner patch)", () => {
    const o = run({ scriptPath: "x.mjs" });
    expect(o.additionalContext).toMatch(/verified outcomes/);
    expect(o.additionalContext).toMatch(/never a target on its own/);
    expect(o.additionalContext).not.toMatch(/resource to USE/);
  });
});
