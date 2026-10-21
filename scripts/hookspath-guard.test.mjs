// #362 (P0-H case 12): the shared core.hooksPath is rewritten ABSOLUTE by the Claude Code harness when
// an Agent call asks for an isolation worktree -- measured twice on 2026-09-03, once in the middle of
// this lane's pre-push gate, where scripts/hookspath-fleet-guard.test.mjs then failed for every lane
// on the machine. The guard was right (an absolute hooksPath aims every worktree at one checkout's
// hooks); the lane was red for something it did not do. This file pins the two-layer answer in
// .claude/hooks/hookspath-guard.mjs: the isolation worktree is refused before it is created, and the
// shared value is restored after any Agent call regardless.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { GIT_SPAWN_TIMEOUT_MS } from "../src/test/tree-walk-budget.ts";
import {
  RELATIVE_HOOKS,
  decideAgent,
  isAbsoluteHooksPath,
  readSharedHooksPath,
  repairPlan,
  restoreSharedHooksPath,
} from "../.claude/hooks/hookspath-guard.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = "hookspath-guard.mjs";

describe("PreToolUse(Agent): an isolation worktree is refused, everything else is not this hook's", () => {
  it("denies isolation \"worktree\" and says why in the fleet guard's terms", () => {
    const v = decideAgent({ subagent_type: "Explore", isolation: "worktree" });
    expect(v.deny).toBe(true);
    expect(v.reason).toMatch(/core\.hooksPath/);
    expect(v.reason).toMatch(/hookspath-fleet-guard/);
    expect(v.reason).toMatch(/without isolation/);
  });
  it("allows an Agent call with no isolation, and one with remote isolation", () => {
    expect(decideAgent({ subagent_type: "Explore" }).deny).toBe(false);
    expect(decideAgent({ subagent_type: "claude", isolation: "remote" }).deny).toBe(false);
    expect(decideAgent(undefined).deny).toBe(false);
  });
});

// 2026-10-21 (cloud-lane audit): the deny above was unconditional, so a checkout with NO shared
// core.hooksPath — every hosted claude.ai/code clone, where the launcher never set one — refused an
// isolation worktree it could not have harmed. The owner patch
// docs/superpowers/specs/2026-10-21-hookspath-guard-unset-allow.patch gives decideAgent a second
// argument, the readSharedHooksPath() result, and allows when there is nothing to protect. Until the
// patch is applied decideAgent.length is 1 and these cases skip; the legacy pin above keeps holding.
describe("PreToolUse(Agent): a checkout with no shared hooksPath has nothing to protect (owner patch)", () => {
  const PATCHED = decideAgent.length >= 2;
  it.skipIf(!PATCHED)("allows an isolation worktree when the shared value is unset", () => {
    const v = decideAgent({ subagent_type: "Explore", isolation: "worktree" }, { file: "x", values: [] });
    expect(v.deny).toBe(false);
    expect(String(v.note || "")).toMatch(/no shared core\.hooksPath/);
  });
  it.skipIf(!PATCHED)("allows it outside a repository, where there is no shared config at all", () => {
    expect(decideAgent({ subagent_type: "Explore", isolation: "worktree" }, null).deny).toBe(false);
  });
  it.skipIf(!PATCHED)("still denies when a relative shared hooksPath is in force (the #362 case)", () => {
    const v = decideAgent({ subagent_type: "Explore", isolation: "worktree" }, { file: "x", values: [RELATIVE_HOOKS] });
    expect(v.deny).toBe(true);
    expect(v.reason).toMatch(/hookspath-fleet-guard/);
  });
  it.skipIf(!PATCHED)("an omitted second argument keeps the unconditional refusal (no caller can widen it by accident)", () => {
    expect(decideAgent({ subagent_type: "Explore", isolation: "worktree" }).deny).toBe(true);
  });
});

describe("what counts as an absolute hooksPath (git accepts all of these)", () => {
  it("drive, UNC and POSIX roots are absolute; the relative default is not", () => {
    expect(isAbsoluteHooksPath("C:\\Users\\Kuya\\code\\sentinel\\.githooks")).toBe(true);
    expect(isAbsoluteHooksPath("C:/Users/Kuya/code/sentinel/.githooks")).toBe(true);
    expect(isAbsoluteHooksPath("\\\\server\\share\\.githooks")).toBe(true);
    expect(isAbsoluteHooksPath("/c/Users/Kuya/code/sentinel/.githooks")).toBe(true);
    expect(isAbsoluteHooksPath(RELATIVE_HOOKS)).toBe(false);
    expect(isAbsoluteHooksPath("")).toBe(false);
    expect(isAbsoluteHooksPath(undefined)).toBe(false);
  });
  it("the plan fixes only when an absolute value is present, and names it", () => {
    expect(repairPlan([RELATIVE_HOOKS])).toEqual({ absolute: [], fix: false });
    expect(repairPlan([])).toEqual({ absolute: [], fix: false });
    const p = repairPlan(["C:\\x\\.githooks", RELATIVE_HOOKS]);
    expect(p.fix).toBe(true);
    expect(p.absolute).toEqual(["C:\\x\\.githooks"]);
  });
});

describe("PostToolUse(Agent): the shared config is restored on a real repository", () => {
  const dirs = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  const fixture = () => {
    const dir = mkdtempSync(join(tmpdir(), "hookspath-guard-"));
    dirs.push(dir);
    const git = (args) => execFileSync("git", ["-c", "core.hooksPath=", ...args], { cwd: dir, encoding: "utf8" });
    git(["init", "-q"]);
    return { dir, git };
  };

  it("restores an absolute value to .githooks and reports what it replaced", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    const f = fixture();
    const abs = join(f.dir, ".githooks");
    f.git(["config", "core.hooksPath", abs]);
    const before = readSharedHooksPath(f.dir);
    expect(before.values).toEqual([abs]);
    const r = restoreSharedHooksPath(f.dir);
    expect(r.restored).toBe(true);
    expect(r.was).toEqual([abs]);
    expect(readSharedHooksPath(f.dir).values).toEqual([RELATIVE_HOOKS]);
  });

  it("leaves a relative value alone, and an unset key alone", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    const f = fixture();
    f.git(["config", "core.hooksPath", RELATIVE_HOOKS]);
    expect(restoreSharedHooksPath(f.dir)).toMatchObject({ restored: false, values: [RELATIVE_HOOKS] });
    const g = fixture();
    expect(readSharedHooksPath(g.dir).values).toEqual([]);
    expect(restoreSharedHooksPath(g.dir)).toMatchObject({ restored: false, values: [] });
  });

  it("fails OPEN: a folder that is not a repository yields null, never a throw", () => {
    const dir = mkdtempSync(join(tmpdir(), "hookspath-guard-norepo-"));
    dirs.push(dir);
    expect(readSharedHooksPath(dir)).toBeNull();
    expect(restoreSharedHooksPath(dir)).toBeNull();
  });
});

describe("the hook is wired for BOTH events in .claude/settings.json", () => {
  const settings = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));
  const commandsFor = (event) =>
    (settings.hooks?.[event] ?? [])
      .filter((h) => String(h.matcher ?? "").split("|").includes("Agent"))
      .flatMap((h) => (h.hooks ?? []).map((x) => String(x.command ?? "")));
  it("PreToolUse(Agent) runs the guard, so the isolation worktree is refused before it exists", () => {
    expect(commandsFor("PreToolUse").some((c) => c.includes(HOOK))).toBe(true);
  });
  it("PostToolUse(Agent) runs the guard, so a harness-made flip is repaired after any agent", () => {
    expect(commandsFor("PostToolUse").some((c) => c.includes(HOOK))).toBe(true);
  });
});

describe("this repository's shared config is relative right now", () => {
  it("core.hooksPath in the common git dir is .githooks, not an absolute path", () => {
    const shared = readSharedHooksPath(ROOT);
    expect(shared).not.toBeNull();
    expect(repairPlan(shared.values).fix).toBe(false);
  });
});
