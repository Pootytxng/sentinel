// Guard for spec §5.3: the launcher may install VERIFICATION; it may never install BEHAVIOUR.
//
// Writing a settings overlay into a folder is exactly the kind of quiet mutation this whole train
// exists to prevent, so the line has to be mechanical rather than remembered: the overlay may add
// the SessionStart assert hook and nothing else. Any `env` key — the context window above all —
// would change how the session behaves, and that is Class B: verify and refuse, never write.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ASSERT_HOOK_MARKER, planOverlay, pruneDeadOverlay, removeOverlay, writeOverlay } from "./overlay.mjs";

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
    // The one canonical hook (decision 2), reached from the control folder — not the retired
    // tools/entry/session-assert-hook.mjs, which no longer exists to be pointed at.
    expect(cmd).toContain(join(".claude", "hooks", "session-root-assert.mjs"));
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

// Owner decision 3 (Issue #18, 2026-07-30): the TRACKED SessionStart registration is primary; this
// overlay is demoted to a fallback for branches that predate it.
//
// This is not tidiness. Hook groups CONCATENATE across settings layers, so a tracked registration
// plus a local overlay means the assert runs TWICE. Before #216 that bricked the launcher outright:
// the first run consumed the single-use launch token and the second refused the token it had just
// spent, so every launch into an up-to-date branch failed. Verification is by facts now and the two
// runs agree — but the session is still handed its whole SessionStart output twice, brief and
// opening instruction included. The overlay must therefore stand down whenever the target already
// registers the assert itself.
describe("the overlay is a fallback, not a second copy", () => {
  // A plain string literal, so `${...}` stays literal text — this is what settings.json really holds.
  const PROJECT_DIR_VAR = "${CLAUDE_PROJECT_DIR}";
  const trackedSettings = {
    hooks: {
      SessionStart: [
        {
          hooks: [
            {
              type: "command",
              command: `node "${join(PROJECT_DIR_VAR, ".claude", "hooks", "session-root-assert.mjs")}"`,
              timeout: 10,
              statusMessage: ASSERT_HOOK_MARKER,
            },
          ],
        },
      ],
    },
  };

  const withTracked = (name, tracked) => {
    const dir = fresh(name);
    writeFileSync(join(dir, ".claude", "settings.json"), JSON.stringify(tracked, null, 2));
    return dir;
  };

  it("stands down when the target's tracked settings already register the assert", () => {
    const plan = planOverlay({ dir: withTracked("j", trackedSettings), controlDir: CONTROL });
    expect(plan.changed).toBe(false);
    expect(plan.adds).toEqual([]);
    expect(plan.reason).toMatch(/tracked/i);
  });

  it("writes nothing at all in that case — two asserts would announce the session twice", () => {
    const dir = withTracked("k", trackedSettings);
    const r = writeOverlay({ dir, controlDir: CONTROL });
    expect(r.wrote).toBe(false);
    expect(existsSync(join(dir, ".claude", "settings.local.json"))).toBe(false);
  });

  it("still installs itself on a branch whose tracked settings carry no assert", () => {
    const dir = withTracked("l", { hooks: { PostToolUse: [] } });
    expect(planOverlay({ dir, controlDir: CONTROL }).changed).toBe(true);
    expect(writeOverlay({ dir, controlDir: CONTROL }).wrote).toBe(true);
  });

  it("still installs itself on a branch with no tracked settings file at all", () => {
    const dir = fresh("m");
    expect(planOverlay({ dir, controlDir: CONTROL }).changed).toBe(true);
    expect(writeOverlay({ dir, controlDir: CONTROL }).wrote).toBe(true);
  });
});

// Measured live on 2026-07-30 while proving decision 8. The launch that opened the session wrote an
// overlay pointing at `compy-control\tools\entry\session-assert-hook.mjs`. Decision 2 then moved that
// file to `.claude/hooks/session-root-assert.mjs`, the control folder fast-forwarded, and the old path
// stopped existing — so the next launch into that same folder refused, permanently, on a hook the
// launcher itself had registered. Standing down is not enough: an overlay that is no longer wanted has
// to be TAKEN BACK, or the launcher leaves a landmine addressed to itself.
describe("a stale overlay is worse than no overlay", () => {
  const PROJECT_DIR_VAR = "${CLAUDE_PROJECT_DIR}";
  const tracked = {
    hooks: {
      SessionStart: [
        {
          hooks: [
            {
              type: "command",
              command: `node "${join(PROJECT_DIR_VAR, ".claude", "hooks", "session-root-assert.mjs")}"`,
              statusMessage: ASSERT_HOOK_MARKER,
            },
          ],
        },
      ],
    },
  };
  const OLD_CONTROL = "C:\\Users\\Kuya\\code\\compy-control-old";
  const staleGroup = {
    hooks: [
      {
        type: "command",
        command: `node "${join(OLD_CONTROL, "tools", "entry", "session-assert-hook.mjs")}"`,
        timeout: 10,
        statusMessage: ASSERT_HOOK_MARKER,
      },
    ],
  };
  const withStale = (name, trackedSettings = null) => {
    const dir = fresh(name, {
      permissions: { allow: ["Bash(git status)"] },
      hooks: { SessionStart: [staleGroup], PostToolUse: [{ matcher: "Write", hooks: [] }] },
    });
    if (trackedSettings) writeFileSync(join(dir, ".claude", "settings.json"), JSON.stringify(trackedSettings, null, 2));
    return dir;
  };

  it("plans to REMOVE the old overlay when the branch now registers the assert itself", () => {
    const plan = planOverlay({ dir: withStale("n", tracked), controlDir: CONTROL });
    expect(plan.changed).toBe(true);
    expect(plan.removes).toContain("hooks.SessionStart");
    expect(plan.adds).toEqual([]);
  });

  it("takes it back, leaving everything else in the file untouched", () => {
    const dir = withStale("o", tracked);
    const r = writeOverlay({ dir, controlDir: CONTROL });
    expect(r.wrote).toBe(false);
    expect(r.removed).toBe(true);
    const after = JSON.parse(readFileSync(join(dir, ".claude", "settings.local.json"), "utf8"));
    expect(JSON.stringify(after)).not.toContain(ASSERT_HOOK_MARKER);
    expect(after.permissions).toEqual({ allow: ["Bash(git status)"] });
    expect(after.hooks.PostToolUse).toHaveLength(1);
  });

  it("refreshes a stale path instead of calling it 'already in place'", () => {
    // The fallback branch has the same rot: an overlay whose command points at a file the control
    // folder no longer has is present, so the old check called it done — and left it pointing at
    // nothing. Presence is not correctness.
    const dir = withStale("p");
    const plan = planOverlay({ dir, controlDir: CONTROL });
    expect(plan.changed).toBe(true);
    expect(writeOverlay({ dir, controlDir: CONTROL }).wrote).toBe(true);
    const after = JSON.parse(readFileSync(join(dir, ".claude", "settings.local.json"), "utf8"));
    expect(after.hooks.SessionStart).toHaveLength(1);
    const cmd = after.hooks.SessionStart[0].hooks[0].command;
    expect(cmd).toContain(CONTROL);
    expect(cmd).not.toContain("session-assert-hook.mjs");
  });

  it("still writes nothing when there is no overlay to take back", () => {
    const dir = fresh("q");
    writeFileSync(join(dir, ".claude", "settings.json"), JSON.stringify(tracked, null, 2));
    const r = writeOverlay({ dir, controlDir: CONTROL });
    expect(r.wrote).toBe(false);
    expect(r.removed).toBe(false);
    expect(existsSync(join(dir, ".claude", "settings.local.json"))).toBe(false);
  });
});

// --no-overlay means "do not install the assert", not "leave a corpse in the settings file". The
// two write paths above only clear the leftover as a side effect of running; the flag skips both,
// and then the session starts with a hook registration pointing at a file that is not there.
describe("the leftover is cleared even when the assert is not installed", () => {
  const deadCmd = () => `node "${join(root, "gone", "session-assert-hook.mjs")}"`;

  const withGroups = (name, groups) =>
    fresh(name, { permissions: { allow: ["Bash"] }, hooks: { SessionStart: groups } });

  const ours = (command) => ({ hooks: [{ type: "command", command, timeout: 10, statusMessage: ASSERT_HOOK_MARKER }] });

  it("removes our group when the file it points at is gone", () => {
    const dir = withGroups("r", [ours(`node "${join(root, "gone", "session-assert-hook.mjs")}"`)]);
    const r = pruneDeadOverlay({ dir });
    expect(r.pruned).toHaveLength(1);
    const after = JSON.parse(readFileSync(join(dir, ".claude", "settings.local.json"), "utf8"));
    expect(after.hooks.SessionStart).toEqual([]);
    expect(after.permissions.allow).toEqual(["Bash"]);
  });

  it("keeps our group when the file it points at exists", () => {
    const live = join(root, "s-hook.mjs");
    writeFileSync(live, "// fixture\n");
    const dir = withGroups("s", [ours(`node "${live}"`)]);
    const r = pruneDeadOverlay({ dir });
    expect(r.pruned).toEqual([]);
    const after = JSON.parse(readFileSync(join(dir, ".claude", "settings.local.json"), "utf8"));
    expect(after.hooks.SessionStart).toHaveLength(1);
  });

  it("never touches a group that is not ours, dead or not", () => {
    const dir = withGroups("t", [{ hooks: [{ type: "command", command: deadCmd() }] }]);
    const r = pruneDeadOverlay({ dir });
    expect(r.pruned).toEqual([]);
    const after = JSON.parse(readFileSync(join(dir, ".claude", "settings.local.json"), "utf8"));
    expect(after.hooks.SessionStart).toHaveLength(1);
  });

  it("writes nothing at all when there is no overlay file", () => {
    const dir = fresh("u");
    expect(pruneDeadOverlay({ dir }).pruned).toEqual([]);
    expect(existsSync(join(dir, ".claude", "settings.local.json"))).toBe(false);
  });
});
