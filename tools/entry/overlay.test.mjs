// Guard for spec §5.3: the launcher may install VERIFICATION; it may never install BEHAVIOUR.
//
// Writing a settings overlay into a folder is exactly the kind of quiet mutation this whole train
// exists to prevent, so the line has to be mechanical rather than remembered: the overlay may add
// the SessionStart assert hook and nothing else. Any `env` key — the context window above all —
// would change how the session behaves, and that is Class B: verify and refuse, never write.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ASSERT_HOOK_MARKER, planOverlay, removeOverlay, writeOverlay } from "./overlay.mjs";

let root;
const CONTROL = "C:\\Users\\Kuya\\code\\compy-control";

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "compy-entry-overlay-"));
});
afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* locked file on Windows must not fail the suite */
  }
});

const fresh = (name, existing = null) => {
  const dir = join(root, name);
  mkdirSync(join(dir, ".claude"), { recursive: true });
  if (existing) writeFileSync(join(dir, ".claude", "settings.local.json"), JSON.stringify(existing, null, 2));
  return dir;
};

describe("what the overlay is allowed to contain", () => {
  it("adds a SessionStart hook and nothing else", () => {
    const plan = planOverlay({ dir: fresh("a"), controlDir: CONTROL });
    expect(Object.keys(plan.next)).toEqual(["hooks"]);
    expect(Object.keys(plan.next.hooks)).toEqual(["SessionStart"]);
  });

  it("never writes an env key — that would be Class B behaviour", () => {
    const plan = planOverlay({ dir: fresh("b"), controlDir: CONTROL });
    expect(JSON.stringify(plan.next)).not.toMatch(/CLAUDE_CODE_AUTO_COMPACT_WINDOW|CLAUDE_CODE_SUBAGENT_MODEL|"env"/);
  });

  it("points the hook at the control folder's assert, not at a copy in the target", () => {
    const plan = planOverlay({ dir: fresh("c"), controlDir: CONTROL });
    const cmd = plan.next.hooks.SessionStart[0].hooks[0].command;
    expect(cmd).toContain(CONTROL);
    expect(cmd).toContain("session-assert");
  });

  it("marks itself, so it is identifiable and removable", () => {
    const plan = planOverlay({ dir: fresh("d"), controlDir: CONTROL });
    expect(JSON.stringify(plan.next)).toContain(ASSERT_HOOK_MARKER);
  });
});

describe("it preserves whatever was already there", () => {
  const existing = {
    permissions: { allow: ["Bash(git status)"] },
    hooks: { PostToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "node impeccable.mjs" }] }] },
  };

  it("keeps unrelated keys untouched", () => {
    const dir = fresh("e", existing);
    writeOverlay({ dir, controlDir: CONTROL });
    const after = JSON.parse(readFileSync(join(dir, ".claude", "settings.local.json"), "utf8"));
    expect(after.permissions).toEqual(existing.permissions);
    expect(after.hooks.PostToolUse).toEqual(existing.hooks.PostToolUse);
    expect(after.hooks.SessionStart).toHaveLength(1);
  });

  it("is idempotent — relaunching does not stack duplicate hooks", () => {
    const dir = fresh("f", existing);
    writeOverlay({ dir, controlDir: CONTROL });
    writeOverlay({ dir, controlDir: CONTROL });
    const after = JSON.parse(readFileSync(join(dir, ".claude", "settings.local.json"), "utf8"));
    expect(after.hooks.SessionStart).toHaveLength(1);
  });

  it("removal takes back only what it added", () => {
    const dir = fresh("g", existing);
    writeOverlay({ dir, controlDir: CONTROL });
    removeOverlay({ dir });
    const after = JSON.parse(readFileSync(join(dir, ".claude", "settings.local.json"), "utf8"));
    expect(after.permissions).toEqual(existing.permissions);
    expect(after.hooks.PostToolUse).toEqual(existing.hooks.PostToolUse);
    expect(after.hooks.SessionStart ?? []).toHaveLength(0);
  });

  it("reports the diff before writing, so nothing is written unannounced", () => {
    const plan = planOverlay({ dir: fresh("h", existing), controlDir: CONTROL });
    expect(plan.file).toMatch(/settings\.local\.json$/);
    expect(plan.adds).toContain("hooks.SessionStart");
    expect(plan.changed).toBe(true);
  });

  it("reports no change when the overlay is already in place", () => {
    const dir = fresh("i", existing);
    writeOverlay({ dir, controlDir: CONTROL });
    expect(planOverlay({ dir, controlDir: CONTROL }).changed).toBe(false);
  });
});
