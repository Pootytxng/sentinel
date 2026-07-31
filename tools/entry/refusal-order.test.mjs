// The one line Kuya reads when a launch refuses — and the one thing he must never be told to run.
//
// A refusal prints ONE "Do this:". Which one it printed was decided by the order the checks happen
// to be pushed in `reconcile`, which is an implementation detail, not a judgement about what matters
// to the owner: a run that failed both `hooks.present` (which the launcher repairs itself) and
// `task.gate` (which only Kuya can settle) led with the hooks line. And that hooks line said
// "Run the launcher with --repair", which is the exact chore #23 exists to delete — outcome 6 is
// that Kuya never runs --repair, never types PowerShell, never relays anything between tools.
//
// Three properties, mechanized so no future check can quietly reintroduce the defect:
//   1. every remediation-carrying check has an explicit rank, and self-repairing ones rank last;
//   2. no owner-facing remediation hands Kuya a command line;
//   3. a refusal with several failures says so, instead of presenting one of them as the whole story.
//
// A fourth guard rides along because it is the same defect wearing a different hat: the auto-repair
// path keyed off `check.id`, and checks are built with `name`. It never once fired.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { REMEDIATION_ORDER, reconcile } from "./preflight.mjs";
import { verifyHooks } from "./hooks-verify.mjs";
import { repairHooksIfSafe } from "./launch.mjs";

const PS1 = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "compy-entry.ps1");
const src = readFileSync(PS1, "utf8");
const hasPwsh = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"], { encoding: "utf8" }).status === 0;

const FOLDER = "C:\\Users\\Kuya\\code\\sentinel-workflow";
const BRANCH = "feat/single-entry-workflow";
const NOW = new Date("2026-07-30T12:00:00Z");
const SHA = "a".repeat(40);

const root = mkdtempSync(join(tmpdir(), "compy-entry-refusal-"));
afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* a locked file on Windows must not fail the suite */
  }
});

/** Everything agreeing, so a test can break exactly one thing and see exactly one refusal. */
function world(overrides = {}) {
  return {
    board: { reachable: true },
    self: { lane: "Claude Code" },
    now: NOW,
    task: {
      number: 23,
      title: "One owner-facing Compy entrypoint",
      status: "Active",
      lane: "Claude Code",
      gate: "None",
      worktreeBranch: `${FOLDER} @ ${BRANCH}`,
      nextAction: "Implement the reconciler.",
      claimExpires: "2026-07-31",
    },
    items: [{ number: 23, status: "Active", lane: "Claude Code", worktreeBranch: `${FOLDER} @ ${BRANCH}` }],
    claim: { issue: 23, lane: "Claude Code", folder: FOLDER, branch: BRANCH, expires: "2026-07-31" },
    handoff: null,
    checkouts: [
      { path: FOLDER, branch: BRANCH, kind: "linked", commonDir: "C:\\Users\\Kuya\\code\\sentinel\\.git", remote: "git@github.com:Pootytxng/sentinel.git" },
    ],
    gitState: { ok: true, branch: BRANCH, detached: false, clean: true, workingTreeClean: true, modified: 0, untracked: 0, staged: 0, stashed: 0, ahead: 0, behind: 0, unmerged: 0, files: { modified: [], untracked: [], staged: [], unmerged: [] } },
    expectedCommonDir: "C:\\Users\\Kuya\\code\\sentinel\\.git",
    base: { ok: true, ref: "origin/main", sha: SHA },
    window: {
      intended: { window: 150000, reason: "default policy window", marathon: false },
      effective: { window: 150000, configured: true, source: "settings", file: `${FOLDER}\\.claude\\settings.json`, ignored: [] },
    },
    subagentModel: { value: "sonnet", source: `${FOLDER}\\.claude\\settings.json` },
    hooks: { ok: true, checked: new Array(7).fill({}), missing: [], stale: [], remediation: null },
    processes: [],
    ...overrides,
  };
}

/** A hooks fact that fails with a remediation, without needing a folder on disk. */
const brokenHooks = {
  ok: false,
  checked: new Array(7).fill({}),
  missing: [{ name: "stop-continue.mjs", file: join(FOLDER, ".claude", "hooks", "stop-continue.mjs") }],
  stale: [],
  dir: FOLDER,
  remediation: "1 registered hook does not exist. The launcher restores the canonical set itself.",
};

describe("which failure the owner is told about", () => {
  it("ranks every check that can carry a remediation — a new check cannot land at an arbitrary spot", () => {
    const names = reconcile(world()).checks.map((c) => c.name);
    expect(new Set(REMEDIATION_ORDER).size, "no duplicate ranks").toBe(REMEDIATION_ORDER.length);
    for (const n of names) expect(REMEDIATION_ORDER, `${n} has a rank`).toContain(n);
    for (const n of REMEDIATION_ORDER) expect(names, `${n} is a real check`).toContain(n);
  });

  it("leads with what only Kuya can settle, not with what the launcher repairs itself", () => {
    // Push order puts hooks.present before board.nextAction and after task.gate; neither position is
    // a statement about which one Kuya should read first.
    const r = reconcile(world({ hooks: brokenHooks, task: { ...world().task, gate: "Kuya" } }));
    expect(r.verdict).toBe("REFUSE");
    expect(r.remediation.length).toBeGreaterThan(1);
    expect(r.remediation[0]).toMatch(/owner territory/);
  });

  it("never leads with the self-repairing check, whatever it was pushed next to", () => {
    const r = reconcile(world({ hooks: brokenHooks, task: { ...world().task, nextAction: "Something else entirely." }, handoff: { nextAction: "Implement the reconciler." } }));
    expect(r.remediation.length).toBe(2);
    expect(r.remediation[0], "the drifted board field, not the hooks").toMatch(/newest durable handoff/);
    expect(r.remediation.at(-1)).toBe(brokenHooks.remediation);
  });

  it("keeps unsaved work ahead of anything cosmetic", () => {
    const dirty = { ...world().gitState, clean: false, workingTreeClean: false, modified: 2, files: { modified: ["a.ts", "b.ts"], untracked: [], staged: [], unmerged: [] } };
    const r = reconcile(world({ gitState: dirty, hooks: brokenHooks, subagentModel: { value: "opus", source: "x" } }));
    expect(r.remediation[0]).toMatch(/Decide what to do with this work/);
  });
});

describe("no remediation hands Kuya a command", () => {
  it("does not tell him to run the launcher with --repair — outcome 6 is that he never does", () => {
    // The real text, from the real verifier, on a folder whose registered hooks are genuinely absent.
    const dir = join(root, "behind");
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(
      join(dir, ".claude", "settings.json"),
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/stop-continue.mjs"' }] }] } }),
    );
    const v = verifyHooks({ dir, home: join(root, "no-home") });
    expect(v.ok).toBe(false);
    expect(v.remediation).not.toMatch(/--repair/);
    expect(v.remediation, "it still says what will happen instead").toMatch(/launcher/i);
  });

  it("does not name a flag in the foreign-registration case either — that one is not his to run", () => {
    const dir = join(root, "foreign");
    const elsewhere = join(root, "control", ".claude", "hooks", "ghost.mjs");
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(
      join(dir, ".claude", "settings.json"),
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: `node "${elsewhere.replace(/\\/g, "\\\\")}"` }] }] } }),
    );
    const v = verifyHooks({ dir, home: join(root, "no-home") });
    expect(v.ok).toBe(false);
    expect(v.remediation).not.toMatch(/--repair/);
  });

  it("holds for every remediation the reconciler can produce", () => {
    const r = reconcile(
      world({
        board: { reachable: false, error: "gh not authenticated" },
        task: { ...world().task, status: "Blocked", gate: "Kuya" },
        claim: { issue: 99, lane: "Codex", folder: FOLDER, branch: BRANCH, expires: "2026-07-31" },
        gitState: { ...world().gitState, clean: false, workingTreeClean: false, modified: 1, files: { modified: ["a.ts"], untracked: [], staged: [], unmerged: [] } },
        hooks: brokenHooks,
        processes: [{ name: "claude.exe", count: 1, contends: true }],
      }),
    );
    for (const text of r.remediation) {
      expect(text, `owner-facing text names no flag: ${text}`).not.toMatch(/(^|\s)--[a-z]/);
      expect(text).not.toMatch(/pwsh|powershell|compy-entry\.ps1/i);
    }
  });
});

describe("the refusal on screen", () => {
  it.skipIf(!hasPwsh)("says how many checks failed instead of presenting one as the whole story", () => {
    const start = src.indexOf("if ($launchCode -ne 0) {");
    const end = src.indexOf("if ($DryRun) {", start);
    expect(start, "the refusal block is findable").toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);

    const harness = join(root, "refusal.ps1");
    const run = (remediation) => {
      writeFileSync(
        harness,
        [
          "function Bad($t) { Write-Host $t }",
          "function Note($t) { Write-Host $t }",
          "function Hold-Window { }",
          "$Issue = 23",
          "$Details = $false",
          "$LogFile = 'C:\\log.txt'",
          "$launchCode = 1",
          `$result = @{ reason = 'preflight refused #23'; remediation = @(${remediation}) }`,
          src.slice(start, end),
        ].join("\n"),
        "utf8",
      );
      const r = spawnSync("pwsh", ["-NoProfile", "-File", harness], { encoding: "utf8" });
      return r.stdout ?? "";
    };

    const many = run("'settle this first','and this','and this too'");
    expect(many).toMatch(/Do this: settle this first/);
    expect(many, "three failures are not one failure").toMatch(/3 checks/);

    const one = run("'settle this first'");
    expect(one).toMatch(/Do this: settle this first/);
    expect(one, "one failure is not announced as a count").not.toMatch(/1 check[s]? /);
  });
});

describe("the repair that never ran", () => {
  it("recognises the hooks row by the name checks actually carry", () => {
    // `failed[0].id` was always undefined — `mk()` builds `name`. Guard 5 (a missing canonical hook
    // set is repaired automatically) was unreachable in the real launcher, and nothing said so.
    const dir = join(root, "repairable");
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(
      join(dir, ".claude", "settings.json"),
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/stop-continue.mjs"' }] }] } }),
    );
    const facts = { hooks: verifyHooks({ dir, home: join(root, "no-home") }) };
    const verdict = { verdict: "REFUSE", checks: [{ name: "git.clean", ok: true }, { name: "hooks.present", ok: false }] };
    const r = repairHooksIfSafe({ facts, verdict, controlDir: join(root, "control"), dryRun: true });
    expect(r.attempted, "the auto-repair path is reachable at all").toBe(true);
  });

  it("still refuses to repair when something else is wrong too", () => {
    const verdict = { verdict: "REFUSE", checks: [{ name: "git.clean", ok: false }, { name: "hooks.present", ok: false }] };
    const r = repairHooksIfSafe({ facts: { hooks: { dir: root } }, verdict, controlDir: root, dryRun: true });
    expect(r.attempted).toBe(false);
  });
});
