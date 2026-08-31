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
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
  // #278 — the same rule, applied to the shell, plus the resolver both guards share.
  "shell-ownership-assert.mjs",
  "target-ownership.mjs",
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

  it("keeps the shell OUT of this hook's matcher — that separation is the escape hatch", async () => {
    // Spec §3c (2026-08-21) left Bash unmatched because a hook that can refuse its own repair is how
    // a machine locks itself out. #278 closes the hole WITHOUT taking that hatch away: the shell is
    // guarded by a different hook with its own off switch, so a wrong shell checker cannot take
    // `Write` down with it, and a wrong `Write` refusal is still repairable from a shell this file
    // does not decide. If Bash ever joins THIS matcher, both halves are gone at once.
    const entry = pre.find((e) => String(e.matcher ?? "").includes("Write"));
    expect(String(entry.matcher).split("|")).not.toContain("Bash");
    const { GUARDED_TOOLS } = await import("../../.claude/hooks/project-write-assert.mjs");
    expect(GUARDED_TOOLS.has("Bash")).toBe(false);
  });
});

describe("#278 — the one-writer rule reaches the shell, and the hatch survives", () => {
  const pre = SETTINGS.hooks?.PreToolUse ?? [];

  it("registers the shell guard on EVERY shell tool this installation emits", async () => {
    // Guarding one of them is a hole at the other: the same `sed -i` refused under Bash would walk
    // straight through as a PowerShell call.
    const entry = pre.find((e) => String(e.command ?? JSON.stringify(e)).includes("shell-ownership-assert.mjs"));
    expect(entry, "no PreToolUse entry registers shell-ownership-assert.mjs").toBeTruthy();
    const matched = String(entry.matcher).split("|");
    const { SHELL_TOOLS } = await import("../../.claude/hooks/shell-ownership-assert.mjs");
    for (const tool of SHELL_TOOLS) expect(matched, `${tool} is guarded in code but not matched`).toContain(tool);
  });

  it("points it at the tracked hook file, resolved from the project dir", () => {
    const cmds = hookCommandsOf(SETTINGS, { dir: ROOT })
      .filter((c) => c.event === "PreToolUse")
      .filter((c) => c.file.endsWith("shell-ownership-assert.mjs"));
    expect(cmds).toHaveLength(1);
    expect(cmds[0].file).toBe(join(ROOT, ".claude", "hooks", "shell-ownership-assert.mjs"));
  });

  it("keeps an off switch that lives in the ENVIRONMENT, not in a command", async () => {
    // A lever an agent can pull by prefixing its own command is not a lever. Spec §5.
    const { OFF_SWITCH } = await import("../../.claude/hooks/shell-ownership-assert.mjs");
    const src = readFileSync(join(ROOT, ".claude", "hooks", "shell-ownership-assert.mjs"), "utf8");
    expect(OFF_SWITCH).toBe("COMPY_SHELL_OWNERSHIP_OFF");
    expect(src).toMatch(/env\?\.\[OFF_SWITCH\]\s*===\s*"1"/);
  });

  it("asks ONE resolver where a path lives — two notions of ownership is how they drift", () => {
    for (const hook of ["project-write-assert.mjs", "shell-ownership-assert.mjs"]) {
      const src = readFileSync(join(ROOT, ".claude", "hooks", hook), "utf8");
      expect(src, `${hook} must import the shared resolver`).toMatch(
        /import\s*\{[^}]*\bzoneOf\b[^}]*\}\s*from\s*"\.\/target-ownership\.mjs"/s,
      );
    }
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

// A hook is a script AND, once a test imports it, a module. Node strips a leading `#!` line; the
// bundler vitest transforms modules with does not, so the shebang reaches V8 verbatim and the whole
// suite dies at import with a bare `SyntaxError: Invalid or unexpected token` — no file, no line.
// That is how `project-write-assert.mjs` sat red on main from the day it was written (583c9452):
// three tests across two files failed for a reason none of them named. Nothing is lost by dropping
// it — `.claude/settings.json` runs every hook as `node "<path>"`, so the shebang was never read.
describe("a hook a test imports is a module, and parses like one", () => {
  const HOOKS_DIR = join(ROOT, ".claude", "hooks");
  const TESTS_DIR = HERE;

  // Anchored on the RELATIVE specifier a real import uses. A settings fixture inside a test spells
  // the same folder as "${CLAUDE_PROJECT_DIR}/.claude/hooks/..." and is a string, not an import —
  // matching it would put hooks vitest never parses under a rule they do not owe.
  const IMPORT_PREFIX = "../../.claude/hooks/";

  /** Hook basenames that some test in tools/entry imports — the ones vitest has to parse. */
  const importedHooks = () => {
    const names = new Set();
    for (const f of readdirSync(TESTS_DIR).filter((n) => n.endsWith(".test.mjs"))) {
      for (const line of readFileSync(join(TESTS_DIR, f), "utf8").split("\n")) {
        const at = line.indexOf(IMPORT_PREFIX);
        if (at === -1) continue;
        const rest = line.slice(at + IMPORT_PREFIX.length);
        const end = rest.indexOf(".mjs");
        if (end !== -1) names.add(rest.slice(0, end + 4));
      }
    }
    return [...names].sort();
  };

  it("carries no shebang — the line node hides and the transform does not", () => {
    const imported = importedHooks();
    expect(imported).toContain("project-write-assert.mjs");
    for (const name of imported) {
      const first = readFileSync(join(HOOKS_DIR, name), "utf8").split("\n")[0];
      expect(`${name} starts: ${first.slice(0, 40)}`).not.toContain("#!");
    }
  });

  // Not every file under .claude/hooks is an entrypoint. `target-ownership.mjs` is a LIBRARY two
  // hooks import so that ownership has one definition instead of two that drift; it is never
  // registered and never run on its own. The partition is by whether settings names the file, so a
  // library that quietly grows a registration — or an entrypoint that quietly loses one — is caught.
  const commandsFor = (name) =>
    hookCommandsOf(JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8")))
      .map((h) => h.command)
      .filter((c) => c.includes(name));

  it("is reached by exactly one `node` command in settings, so the shebang buys nothing", () => {
    const entrypoints = importedHooks().filter((name) => commandsFor(name).length > 0);
    expect(entrypoints).toContain("project-write-assert.mjs");
    expect(entrypoints).toContain("shell-ownership-assert.mjs");
    for (const name of entrypoints) {
      const mine = commandsFor(name);
      expect(`${name}: ${mine.length} command(s)`).toBe(`${name}: 1 command(s)`);
      expect(mine[0].startsWith("node ")).toBe(true);
    }
  });

  it("keeps an unregistered hook file honest — a library must be imported by a registered hook", () => {
    const libraries = importedHooks().filter((name) => commandsFor(name).length === 0);
    expect(libraries).toContain("target-ownership.mjs");
    for (const name of libraries) {
      const importers = readdirSync(HOOKS_DIR)
        .filter((f) => f.endsWith(".mjs") && f !== name)
        .filter((f) => readFileSync(join(HOOKS_DIR, f), "utf8").includes(`"./${name}"`));
      expect(`${name}: imported by ${importers.length} hook(s)`).not.toBe(`${name}: imported by 0 hook(s)`);
    }
  });
});
