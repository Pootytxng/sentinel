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
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hookCommandsOf, hookRepairPlan, repairHooks, verifyHooks } from "./hooks-verify.mjs";
import { ASSERT_HOOK_MARKER } from "./overlay.mjs";

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
    expect(r.remediation).toMatch(/launcher restores the canonical set/);
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

  it("does not claim the folder is behind, and rules the automatic repair out instead of prescribing it", () => {
    // The condition is "never send the owner to run a repair that cannot reach this" — and, since
    // refusal-order.test.mjs, never to run anything at all. So the guard is that the text says the
    // launcher CANNOT restore this one, without naming a flag Kuya would have to type.
    const r = foreignOnly();
    expect(r.remediation).not.toMatch(/--repair/);
    expect(r.remediation).not.toMatch(/older commit/);
    expect(r.remediation).toMatch(/can only restore hooks that belong to this folder/);
  });

  it("names the file and points at the settings that register it", () => {
    const r = foreignOnly();
    expect(r.remediation).toContain("session-assert-hook.mjs");
    expect(r.remediation).toMatch(/settings file/);
  });

  it("keeps the automatic remedy when the missing hook does belong to this folder", () => {
    const r = verifyHooks({ dir: missingDir, home: join(root, "no-home") });
    expect(r.remediation).toMatch(/launcher restores the canonical set/);
  });

  it("gives both remedies when both kinds are missing at once", () => {
    const dir = dirWith(
      "both",
      { hooks: { SessionStart: [{ hooks: [{ type: "command", command: foreignCommand }] }] } },
      { hooks: { Stop: [{ hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/stop-continue.mjs"' }] }] } },
    );
    const r = verifyHooks({ dir, home: join(root, "no-home") });
    expect(r.missing).toHaveLength(2);
    expect(r.remediation).toMatch(/launcher restores the canonical set/);
    expect(r.remediation).toMatch(/settings file/);
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

// Measured live on 2026-07-30, one run after the fix above. The corrected remedy printed
// "relaunch through the entrypoint, which takes its own overlay back" — and that was a lie, because
// the verdict runs BEFORE the overlay step (spec §7). The launcher refused on its own leftover,
// every time, forever: the one thing the entrypoint exists to prevent is the owner hand-editing a
// settings file to get in. A defect the launcher created and will deterministically clear on this
// same run is not evidence about the FOLDER, so it must not be counted against it. Forgiveness is
// narrow on purpose: our marker, dead file, outside the folder. Everything else still refuses.
describe("the launcher's own leftover is not the folder's defect", () => {
  const GONE = "C:\\Users\\Kuya\\code\\compy-control-gone";
  const dead = join(GONE, "tools", "entry", "session-assert-hook.mjs");
  const ourGroup = {
    hooks: [{ type: "command", command: `node "${dead}"`, timeout: 10, statusMessage: ASSERT_HOOK_MARKER }],
  };

  const dirWith = (name, local, project = { hooks: {} }) => {
    const dir = join(root, name);
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(join(dir, ".claude", "settings.json"), JSON.stringify(project, null, 2));
    if (local) writeFileSync(join(dir, ".claude", "settings.local.json"), JSON.stringify(local, null, 2));
    return dir;
  };

  const ourLeftover = () =>
    verifyHooks({
      dir: dirWith("ours", { hooks: { SessionStart: [ourGroup] } }),
      home: join(root, "no-home"),
    });

  it("does not refuse — the launcher takes this back on the run that finds it", () => {
    const r = ourLeftover();
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it("reports it as stale rather than swallowing it — disclosure, not silence", () => {
    const r = ourLeftover();
    expect(r.stale).toHaveLength(1);
    expect(r.stale[0].file).toBe(dead);
    expect(r.checked.map((c) => c.file)).toContain(dead);
  });

  it("forgives only OUR marker — an unmarked dead hook from outside still refuses", () => {
    const r = verifyHooks({
      dir: dirWith("ours-unmarked", {
        hooks: { SessionStart: [{ hooks: [{ type: "command", command: `node "${dead}"` }] }] },
      }),
      home: join(root, "no-home"),
    });
    expect(r.ok).toBe(false);
    expect(r.stale).toEqual([]);
  });

  it("forgives nothing --repair can fix: a marked hook INSIDE the folder still refuses", () => {
    // A folder that is behind registers the assert at its own path. That is not our leftover; it is
    // the case --repair exists for, and forgiving it would hide a real missing guard.
    const r = verifyHooks({
      dir: dirWith("ours-inside", null, {
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: "command",
                  command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/session-root-assert.mjs"',
                  statusMessage: ASSERT_HOOK_MARKER,
                },
              ],
            },
          ],
        },
      }),
      home: join(root, "no-home"),
    });
    expect(r.ok).toBe(false);
    expect(r.remediation).toMatch(/launcher restores the canonical set/);
  });

  it("still refuses for the real miss when a leftover sits beside it", () => {
    const r = verifyHooks({
      dir: dirWith(
        "ours-and-real",
        { hooks: { SessionStart: [ourGroup] } },
        { hooks: { Stop: [{ hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/stop-continue.mjs"' }] }] } },
      ),
      home: join(root, "no-home"),
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toHaveLength(1);
    expect(r.stale).toHaveLength(1);
    expect(r.remediation).toMatch(/launcher restores the canonical set/);
  });
});

// Guards 5 and 6 of the #23 program: "missing canonical hooks safely auto-repairable" and "foreign or
// ambiguous hooks that must refuse". Until now every missing hook — including the ordinary case of a
// folder cut before the hooks were tracked — refused and handed Kuya a --repair command to type. That
// is the chore this program deletes, but only for the case the launcher can PROVE, and the proving is
// what these guards pin: the plan must fail closed on every clause, and it must never write over work.
describe("deciding whether the launcher may repair the hooks itself", () => {
  let folder;
  let canonical;
  const all = () => true;
  const none = () => false;

  const plan = (over = {}) =>
    hookRepairPlan({ verify: verifyHooks({ dir: folder, home: join(root, "no-home") }), canonicalDir: canonical, tracked: all, ...over });

  beforeAll(() => {
    canonical = join(root, "control", ".claude", "hooks");
    mkdirSync(canonical, { recursive: true });
    for (const f of ["stop-continue.mjs", "context-size-advisor.mjs", "subagent-model-guard.mjs"]) {
      writeFileSync(join(canonical, f), "// canonical\n");
    }
  });

  const settingsAt = (name, hooks) => {
    folder = join(root, name);
    mkdirSync(join(folder, ".claude"), { recursive: true });
    writeFileSync(join(folder, ".claude", "settings.json"), JSON.stringify({ hooks }, null, 2));
    return folder;
  };
  const inside = (file) => ({ Stop: [{ hooks: [{ type: "command", command: `node "$CLAUDE_PROJECT_DIR/${file}"` }] }] });

  it("repairs the ordinary case: the folder registers the canonical set and has none of it", () => {
    settingsAt("repair-ok", SETTINGS.hooks);
    const p = plan();
    expect(p).toMatchObject({ ok: true, needed: true });
    expect(p.files.sort()).toEqual(["context-size-advisor.mjs", "stop-continue.mjs", "subagent-model-guard.mjs"]);
    expect(p.disclosure).toMatch(/3 hooks were missing/);
  });

  it("has nothing to say when nothing is missing", () => {
    expect(plan({ verify: verifyHooks({ dir: completeDir, home: join(root, "no-home") }) })).toMatchObject({ ok: false, needed: false });
  });

  // Guard 6, the case the owner named: a hook registered by absolute path from somewhere else.
  it("refuses a hook registered from outside the folder — not ours to repair", () => {
    settingsAt("repair-foreign", {
      SessionStart: [{ hooks: [{ type: "command", command: `node "${join(root, "elsewhere", "some-hook.mjs")}"` }] }],
    });
    const p = plan();
    expect(p).toMatchObject({ ok: false, needed: true });
    expect(p.reason).toMatch(/outside/);
    expect(p.files).toEqual([]);
  });

  // Same class, quieter: inside the folder, but not where repair writes. Copying would "succeed" and
  // leave the registration still pointing at nothing — the remedy-that-cannot-work defect again.
  it("refuses a hook registered inside the folder but not at .claude/hooks/", () => {
    settingsAt("repair-misplaced", inside("tools/odd/stop-continue.mjs"));
    const p = plan();
    expect(p.ok).toBe(false);
    expect(p.reason).toMatch(/other than/);
  });

  it("refuses a name the canonical set does not carry — inventing a hook is not repair", () => {
    settingsAt("repair-unknown", inside(".claude/hooks/not-in-the-payload.mjs"));
    const p = plan();
    expect(p.ok).toBe(false);
    expect(p.reason).toMatch(/does not carry not-in-the-payload\.mjs/);
  });

  it("refuses an untracked canonical file — a stray in the control folder is not the payload", () => {
    settingsAt("repair-untracked", SETTINGS.hooks);
    const p = plan({ tracked: none });
    expect(p.ok).toBe(false);
    expect(p.reason).toMatch(/not tracked by git/);
  });

  it("refuses when the control folder has no canonical set at all", () => {
    settingsAt("repair-nocanon", SETTINGS.hooks);
    expect(plan({ canonicalDir: join(root, "no-such-control") })).toMatchObject({ ok: false, needed: true });
  });

  // All-or-nothing on purpose: a partial repair writes files AND leaves the folder still failing.
  it("repairs none of them when one of them cannot be proven", () => {
    settingsAt("repair-mixed", {
      Stop: [{ hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/stop-continue.mjs"' }] }],
      SessionStart: [{ hooks: [{ type: "command", command: `node "${join(root, "elsewhere", "some-hook.mjs")}"` }] }],
    });
    expect(plan().files).toEqual([]);
  });
});

describe("performing the repair", () => {
  let target;
  let canonical;

  beforeAll(() => {
    canonical = join(root, "control2", ".claude", "hooks");
    mkdirSync(canonical, { recursive: true });
    writeFileSync(join(canonical, "a.mjs"), "// canonical a\n");
    writeFileSync(join(canonical, "b.mjs"), "// canonical b\n");
  });

  it("writes only the files it was asked for, and leaves the rest of the folder alone", () => {
    target = join(root, "narrow");
    mkdirSync(join(target, ".claude", "hooks"), { recursive: true });
    // b.mjs is already there and has been edited locally. Automatic repair may never overwrite work.
    writeFileSync(join(target, ".claude", "hooks", "b.mjs"), "// EDITED BY HAND\n");

    repairHooks({ dir: target, canonicalDir: canonical, only: ["a.mjs"] });
    expect(existsSync(join(target, ".claude", "hooks", "a.mjs"))).toBe(true);
    expect(readFileSync(join(target, ".claude", "hooks", "b.mjs"), "utf8")).toMatch(/EDITED BY HAND/);
  });

  it("still restores the whole set when a human asked for that explicitly", () => {
    const full = join(root, "full");
    mkdirSync(full, { recursive: true });
    expect(repairHooks({ dir: full, canonicalDir: canonical }).wrote.map((w) => w.name).sort()).toEqual(["a.mjs", "b.mjs"]);
  });

  it("plans without writing when asked to look first", () => {
    const dry = join(root, "dry");
    const r = repairHooks({ dir: dry, canonicalDir: canonical, dryRun: true, only: ["a.mjs"] });
    expect(r.wrote).toEqual([]);
    expect(r.planned.map((p) => p.name)).toEqual(["a.mjs"]);
    expect(existsSync(dry)).toBe(false);
  });
});
