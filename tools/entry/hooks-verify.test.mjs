// Guard: a folder whose tracked settings register hooks that do not exist there must refuse.
//
// Why (spec §2 finding 4): `.gitignore:49` ignores `.claude/hooks/` as "machine-local, not shared",
// while the TRACKED `.claude/settings.json` wires all seven by `$CLAUDE_PROJECT_DIR` path. So five
// of six checkouts run with every hook missing — including subagent-model-guard.mjs, a real DENY.
// The entire #14 marathon ran hookless and nothing said a word.
//
// The defect is tracked registration of untracked files, so the fix is not "git add": it is to
// verify and refuse (owner-approved), and to surface the tracking decision to Kuya rather than take
// it. Writing hook files into a folder another lane may own is mutation, so only --repair writes.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hookCommandsOf, verifyHooks } from "./hooks-verify.mjs";

/** The real shape, trimmed: two events, three hooks, `$CLAUDE_PROJECT_DIR` in every command. */
const SETTINGS = {
  hooks: {
    Stop: [
      {
        hooks: [
          { type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/stop-continue.mjs"' },
          { type: "command", command: 'node "${CLAUDE_PROJECT_DIR}/.claude/hooks/context-size-advisor.mjs"' },
        ],
      },
    ],
    PreToolUse: [
      {
        matcher: "Agent",
        hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/subagent-model-guard.mjs"' }],
      },
    ],
  },
};

let root;
let missingDir;
let completeDir;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "compy-entry-hooks-"));

  missingDir = join(root, "missing");
  mkdirSync(join(missingDir, ".claude"), { recursive: true });
  writeFileSync(join(missingDir, ".claude", "settings.json"), JSON.stringify(SETTINGS, null, 2));

  completeDir = join(root, "complete");
  mkdirSync(join(completeDir, ".claude", "hooks"), { recursive: true });
  writeFileSync(join(completeDir, ".claude", "settings.json"), JSON.stringify(SETTINGS, null, 2));
  for (const f of ["stop-continue.mjs", "context-size-advisor.mjs", "subagent-model-guard.mjs"]) {
    writeFileSync(join(completeDir, ".claude", "hooks", f), "// fixture\n");
  }
});

afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* locked file on Windows must not fail the suite */
  }
});

describe("extracting the hook commands", () => {
  it("walks every event and every matcher, not just the first", () => {
    const cmds = hookCommandsOf(SETTINGS);
    expect(cmds).toHaveLength(3);
    expect(cmds.map((c) => c.event).sort()).toEqual(["PreToolUse", "Stop", "Stop"]);
    expect(cmds.find((c) => c.event === "PreToolUse").matcher).toBe("Agent");
  });

  it("resolves $CLAUDE_PROJECT_DIR against the TARGET folder", () => {
    // Measured unset in the tool environment (finding 9), so interpolating from process.env would
    // resolve every hook path to nonsense and then "helpfully" report them all missing everywhere.
    const cmds = hookCommandsOf(SETTINGS, { dir: "C:\\x\\y" });
    expect(cmds[0].file).toBe(join("C:\\x\\y", ".claude", "hooks", "stop-continue.mjs"));
  });

  it("handles both $VAR and ${VAR} forms", () => {
    const cmds = hookCommandsOf(SETTINGS, { dir: "C:\\x\\y" });
    expect(cmds[1].file).toBe(join("C:\\x\\y", ".claude", "hooks", "context-size-advisor.mjs"));
  });

  it("ignores a command that references no file, instead of inventing a failure", () => {
    const cmds = hookCommandsOf({ hooks: { Stop: [{ hooks: [{ type: "command", command: "echo hi" }] }] } });
    expect(cmds[0].file).toBeNull();
  });
});

describe("verification", () => {
  it("refuses when registered hooks are absent — the five-of-six case", () => {
    const r = verifyHooks({ dir: missingDir, home: join(root, "no-home") });
    expect(r.ok).toBe(false);
    expect(r.missing).toHaveLength(3);
    expect(r.missing.map((m) => m.name)).toContain("subagent-model-guard.mjs");
  });

  it("names the guard that is missing, because 'a hook is missing' is not actionable", () => {
    const r = verifyHooks({ dir: missingDir, home: join(root, "no-home") });
    expect(r.remediation).toContain("subagent-model-guard.mjs");
    expect(r.remediation).toMatch(/--repair/);
  });

  it("passes when every registered hook exists", () => {
    const r = verifyHooks({ dir: completeDir, home: join(root, "no-home") });
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.checked).toHaveLength(3);
  });

  it("passes trivially when nothing registers hooks at all", () => {
    const empty = join(root, "empty");
    mkdirSync(join(empty, ".claude"), { recursive: true });
    writeFileSync(join(empty, ".claude", "settings.json"), JSON.stringify({ env: {} }));
    const r = verifyHooks({ dir: empty, home: join(root, "no-home") });
    expect(r.ok).toBe(true);
    expect(r.checked).toEqual([]);
  });

  it("checks hooks from EVERY settings layer, not just the winning one", () => {
    // Claude Code runs every matching hook from every settings file; a local overlay adds to the
    // project's hooks rather than replacing them. Letting a layer replace another here would
    // under-report missing hooks — a fail-OPEN direction, which is the one direction a guard may
    // never fail in. (Measured: it made `code\sentinel` report 6 registered hooks, not 7.)
    const layered = join(root, "layered");
    mkdirSync(join(layered, ".claude"), { recursive: true });
    writeFileSync(
      join(layered, ".claude", "settings.json"),
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/from-project.mjs"' }] }] } }),
    );
    writeFileSync(
      join(layered, ".claude", "settings.local.json"),
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/from-local.mjs"' }] }] } }),
    );
    const r = verifyHooks({ dir: layered, home: join(root, "no-home") });
    expect(r.checked.map((c) => c.name).sort()).toEqual(["from-local.mjs", "from-project.mjs"]);
    expect(r.missing).toHaveLength(2);
  });

  it("writes nothing — verification is not repair", () => {
    verifyHooks({ dir: missingDir, home: join(root, "no-home") });
    const r = verifyHooks({ dir: missingDir, home: join(root, "no-home") });
    expect(r.ok).toBe(false);
    expect(r.missing).toHaveLength(3);
  });
});
