// Guard for owner decisions 2, 3 and 5 (Issue #18, 2026-07-30): `.claude/hooks/` is the single
// canonical hook source, it is TRACKED, it carries the SessionStart root assert, and the
// machine-local settings stay ignored.
//
// Why this has to be mechanical rather than remembered — the defect it replaces (finding 4) was
// exactly a settings file that registered seven hooks nobody could see were missing. A second
// canonical copy, or a re-added ignore line, would reintroduce the same class of silence. So:
//
//   decision 2 — `.claude/hooks/` is tracked, and `tools/entry/hooks/` no longer exists. One source.
//   decision 3 — tracked `.claude/settings.json` registers the SessionStart root assert, and
//                `verifyHooks` counts it, so a folder without the file REFUSES instead of drifting.
//   decision 5 — `.claude/settings.local.json` and `.claude/autopilot.json` stay ignored. Tracking
//                the hooks must not drag machine-local state into the repository with them.
//
// These are repository facts, so this suite reads the real repo rather than a fixture. That is the
// point: a fixture cannot tell you whether the file you are about to merge is tracked. The one
// fixture here is deliberate — the REFUSE case must be provoked without breaking this checkout.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { hookCommandsOf, verifyHooks } from "./hooks-verify.mjs";
import { ASSERT_HOOK_MARKER } from "./overlay.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

const git = (args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

/** `git check-ignore` exits 1 when the path is NOT ignored, which is the answer, not an error. */
const isIgnored = (relPath) => {
  try {
    execFileSync("git", ["check-ignore", "-q", relPath], { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

const trackedUnder = (path) => git(["ls-files", path]).split("\n").filter(Boolean);

const SETTINGS = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));

/** The seven pre-existing hooks, plus the root assert this train adds. */
const EXPECTED_HOOKS = [
  "context-size-advisor.mjs",
  "self-review-reminder.mjs",
  "session-root-assert.mjs",
  "ship-reminder.mjs",
  "stop-continue.mjs",
  "subagent-model-guard.mjs",
  "subagent-throttle.mjs",
  "workflow-usage-guard.mjs",
  // #125 step 4 — armed 2026-08-22 on the owner's word ("do everything"); see the write-refusal
  // describe block below for what "armed" is asserted to mean.
  "project-write-assert.mjs",
];

let scratch = null;
afterAll(() => {
  if (scratch) {
    try {
      rmSync(scratch, { recursive: true, force: true });
    } catch {
      /* a locked file on Windows must not fail the suite */
    }
  }
});

describe("decision 2 — one canonical hook source, and it travels with the branch", () => {
  it("does not ignore .claude/hooks/", () => {
    expect(isIgnored(".claude/hooks/stop-continue.mjs")).toBe(false);
  });

  it("tracks every hook the settings register", () => {
    const tracked = trackedUnder(".claude/hooks").map((p) => p.split("/").pop());
    for (const name of EXPECTED_HOOKS) expect(tracked).toContain(name);
  });

  it("keeps no second copy at tools/entry/hooks — two canonical sources is none", () => {
    expect(existsSync(join(ROOT, "tools", "entry", "hooks"))).toBe(false);
    expect(trackedUnder("tools/entry/hooks")).toEqual([]);
  });

  it("repairs older branches from the tracked set, not from a payload directory", async () => {
    // Assert on the source BEFORE importing: repair.mjs currently runs `process.exit(main(...))` at
    // module scope, which would kill this worker rather than fail a test. Being importable is part
    // of what is being fixed, so check it textually first and get an honest red either way.
    const src = readFileSync(join(HERE, "repair.mjs"), "utf8");
    expect(src, "repair.mjs must only run main() when invoked directly").not.toMatch(
      /^process\.exit\(main\(/m,
    );

    const { CANONICAL_HOOKS } = await import("./repair.mjs");
    expect(CANONICAL_HOOKS).toBe(join(ROOT, ".claude", "hooks"));
  });
});

describe("#125 step 4 — the write refusal is ARMED, and stays armed", () => {
  // The hook was built, tested and left INERT on purpose: arming it changes how the owner's own
  // tooling behaves for every agent on this machine. He armed it 2026-08-22. This block is the
  // guard that keeps it armed — an unwired hook is byte-identical to a deleted one from the user's
  // side, and #125's whole failure mode is a change nobody can attribute later.
  const pre = SETTINGS.hooks?.PreToolUse ?? [];

  it("registers it on every write tool the hook itself claims to guard", () => {
    const entry = pre.find((e) => String(e.matcher ?? "").includes("Write"));
    expect(entry, "no PreToolUse entry matches Write").toBeTruthy();
    // The matcher and the hook's own GUARDED_TOOLS must not drift apart: a tool guarded in code but
    // absent from the matcher never runs the hook at all.
    for (const tool of ["Write", "Edit", "NotebookEdit"]) {
      expect(String(entry.matcher).split("|")).toContain(tool);
    }
  });

  it("points it at the tracked hook file, resolved from the project dir", () => {
    const cmds = hookCommandsOf(SETTINGS, { dir: ROOT })
      .filter((c) => c.event === "PreToolUse")
      .filter((c) => c.file.endsWith("project-write-assert.mjs"));
    expect(cmds).toHaveLength(1);
    expect(cmds[0].file).toBe(join(ROOT, ".claude", "hooks", "project-write-assert.mjs"));
  });

  it("leaves Bash deliberately unguarded — the named hole IS the escape hatch", async () => {
    // Spec §3c: a hook that can refuse its own repair is how a machine locks itself out. If Bash
    // ever joins the matcher, that escape hatch is gone and this test is the thing that says so.
    const entry = pre.find((e) => String(e.matcher ?? "").includes("Write"));
    expect(String(entry.matcher).split("|")).not.toContain("Bash");
    const { GUARDED_TOOLS } = await import("../../.claude/hooks/project-write-assert.mjs");
    expect(GUARDED_TOOLS.has("Bash")).toBe(false);
  });
});

describe("decision 3 — the root assert is registered by tracked settings", () => {
  const sessionStart = SETTINGS.hooks?.SessionStart ?? [];

  it("registers a SessionStart hook at all", () => {
    expect(sessionStart.length).toBeGreaterThan(0);
  });

  it("points it at the tracked hook, resolved from the project dir", () => {
    const cmds = hookCommandsOf(SETTINGS, { dir: ROOT }).filter((c) => c.event === "SessionStart");
    expect(cmds).toHaveLength(1);
    expect(cmds[0].file).toBe(join(ROOT, ".claude", "hooks", "session-root-assert.mjs"));
  });

  it("carries the marker, so the launcher can tell the tracked assert is already there", () => {
    expect(JSON.stringify(sessionStart)).toContain(ASSERT_HOOK_MARKER);
  });

  it("every hook the tracked settings register exists in this checkout", () => {
    for (const c of hookCommandsOf(SETTINGS, { dir: ROOT })) {
      if (!c.file) continue;
      expect(existsSync(c.file), `${c.name} is registered by tracked settings but absent`).toBe(true);
    }
  });

  it("makes a folder that lacks the assert REFUSE, rather than launch unverified", () => {
    scratch ??= mkdtempSync(join(tmpdir(), "compy-entry-tracked-"));
    const dir = join(scratch, "no-hooks");
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(join(dir, ".claude", "settings.json"), JSON.stringify(SETTINGS, null, 2));

    const r = verifyHooks({ dir, home: join(scratch, "no-home"), env: {} });
    expect(r.ok).toBe(false);
    expect(r.missing.map((m) => m.name)).toContain("session-root-assert.mjs");
  });

  it("is self-contained — it is copied alone into folders where tools/entry does not exist", () => {
    const src = readFileSync(join(ROOT, ".claude", "hooks", "session-root-assert.mjs"), "utf8");
    const imports = [...src.matchAll(/^\s*import\s[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) expect(spec).toMatch(/^node:/);
  });
});

describe("decision 5 — machine-local settings and state stay ignored", () => {
  it("keeps .claude/settings.local.json out of the repository", () => {
    expect(isIgnored(".claude/settings.local.json")).toBe(true);
    expect(trackedUnder(".claude/settings.local.json")).toEqual([]);
  });

  it("keeps .claude/autopilot.json out of the repository", () => {
    expect(isIgnored(".claude/autopilot.json")).toBe(true);
    expect(trackedUnder(".claude/autopilot.json")).toEqual([]);
  });
});
