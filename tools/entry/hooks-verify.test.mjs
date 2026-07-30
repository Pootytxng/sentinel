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

// Measured live on 2026-07-30 while proving decision 8. A launch had written an overlay registering
// `compy-control\tools\entry\session-assert-hook.mjs` by ABSOLUTE path; decision 2 renamed that file
// away and the control folder moved forward. The refusal was right. The remedy printed with it was
// not: it said the folder was on an older commit and to run --repair, while the folder was on the
// newest commit and --repair writes into the folder's OWN .claude/hooks/, where that path does not
// point. A remedy that cannot work costs more than no remedy — it sends the owner in a circle.
describe("a missing hook outside this folder is a different failure", () => {
  const GONE = "C:\\Users\\Kuya\\code\\compy-control-gone";
  const foreignCommand = `node "${join(GONE, "tools", "entry", "session-assert-hook.mjs")}"`;

  const dirWith = (name, local, project = { hooks: {} }) => {
    const dir = join(root, name);
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(join(dir, ".claude", "settings.json"), JSON.stringify(project, null, 2));
    if (local) writeFileSync(join(dir, ".claude", "settings.local.json"), JSON.stringify(local, null, 2));
    return dir;
  };

  const foreignOnly = () =>
    verifyHooks({
      dir: dirWith("foreign", { hooks: { SessionStart: [{ hooks: [{ type: "command", command: foreignCommand }] }] } }),
      home: join(root, "no-home"),
    });

  it("still refuses — a hook that cannot load is not a hook", () => {
    const r = foreignOnly();
    expect(r.ok).toBe(false);
    expect(r.missing).toHaveLength(1);
  });

  it("does not claim the folder is behind, and does not prescribe --repair", () => {
    const r = foreignOnly();
    expect(r.remediation).not.toMatch(/--repair/);
    expect(r.remediation).not.toMatch(/older commit/);
  });

  it("names the stale local overlay as the thing to fix", () => {
    const r = foreignOnly();
    expect(r.remediation).toContain("session-assert-hook.mjs");
    expect(r.remediation).toMatch(/settings\.local\.json/);
    expect(r.remediation).toMatch(/relaunch/i);
  });

  it("keeps the --repair remedy when the missing hook does belong to this folder", () => {
    const r = verifyHooks({ dir: missingDir, home: join(root, "no-home") });
    expect(r.remediation).toMatch(/--repair/);
  });

  it("gives both remedies when both kinds are missing at once", () => {
    const dir = dirWith(
      "both",
      { hooks: { SessionStart: [{ hooks: [{ type: "command", command: foreignCommand }] }] } },
      { hooks: { Stop: [{ hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/stop-continue.mjs"' }] }] } },
    );
    const r = verifyHooks({ dir, home: join(root, "no-home") });
    expect(r.missing).toHaveLength(2);
    expect(r.remediation).toMatch(/--repair/);
    expect(r.remediation).toMatch(/settings\.local\.json/);
  });

  it("counts in the grammar the owner reads: one hook does not exist, two do not", () => {
    const one = verifyHooks({
      dir: dirWith("one-missing", null, {
        hooks: { Stop: [{ hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/stop-continue.mjs"' }] }] },
      }),
      home: join(root, "no-home"),
    });
    expect(one.remediation).toMatch(/1 registered hook does not exist/);
    expect(verifyHooks({ dir: missingDir, home: join(root, "no-home") }).remediation).toMatch(/3 registered hooks do not exist/);
  });
});
