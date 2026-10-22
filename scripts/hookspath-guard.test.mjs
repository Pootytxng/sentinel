// #362 (P0-H case 12): the shared core.hooksPath is rewritten ABSOLUTE by the Claude Code harness when
// an Agent call asks for an isolation worktree -- measured twice on 2026-09-03, once in the middle of
// this lane's pre-push gate, where scripts/hookspath-fleet-guard.test.mjs then failed for every lane
// on the machine. The guard was right (an absolute hooksPath aims every worktree at one checkout's
// hooks); the lane was red for something it did not do. This file pins the two-layer answer in
// .claude/hooks/hookspath-guard.mjs: the isolation worktree is refused before it is created, and the
// shared value is restored after any Agent call regardless.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
// argument, the readSharedHooksPath() result, and allows ONLY when absence is positively established:
// the shared config file exists and `git config --get-all` exited 1 (key absent). Unknown is never
// absent (PR #679 exact-head review, P1): null (git could not answer), undefined (no reader) and
// `values: null` (the config could not be read) all keep the denial, and so does a PRESENT-but-empty
// key (`values: [""]`: present is not absent). Until the patch is applied decideAgent.length is 1 and
// these cases skip; the legacy pin above keeps holding.
describe("PreToolUse(Agent): a checkout with no shared hooksPath has nothing to protect (owner patch)", () => {
  const PATCHED = decideAgent.length >= 2;
  const wt = { subagent_type: "Explore", isolation: "worktree" };
  it.skipIf(!PATCHED)("allows an isolation worktree when the shared value is positively unset", () => {
    const v = decideAgent(wt, { file: "x", values: [] });
    expect(v.deny).toBe(false);
    expect(String(v.note || "")).toMatch(/no shared core\.hooksPath/);
  });
  it.skipIf(!PATCHED)("still denies when a relative shared hooksPath is in force (the #362 case)", () => {
    const v = decideAgent(wt, { file: "x", values: [RELATIVE_HOOKS] });
    expect(v.deny).toBe(true);
    expect(v.reason).toMatch(/hookspath-fleet-guard/);
  });
  it.skipIf(!PATCHED)("an omitted second argument keeps the unconditional refusal (no caller can widen it by accident)", () => {
    expect(decideAgent(wt).deny).toBe(true);
  });
  it.skipIf(!PATCHED)("keeps the denial when git could not answer for the folder (null is unknown, not absent)", () => {
    const v = decideAgent(wt, null);
    expect(v.deny).toBe(true);
    expect(v.reason).toMatch(/unknown is not absent/);
  });
  it.skipIf(!PATCHED)("keeps the denial when the shared config could not be read, and says which failure", () => {
    const v = decideAgent(wt, { file: "x", values: null, error: "git config exit 128" });
    expect(v.deny).toBe(true);
    expect(v.reason).toMatch(/git config exit 128/);
    expect(v.reason).toMatch(/unknown is not absent/);
    expect(decideAgent(wt, { file: "x", values: null, error: "shared config file missing" }).deny).toBe(true);
  });
  it.skipIf(!PATCHED)("keeps the denial when the shared key is present but empty (present is not absent)", () => {
    const v = decideAgent(wt, { file: "x", values: [""] });
    expect(v.deny).toBe(true);
    expect(v.reason).toMatch(/present but empty/);
    expect(decideAgent(wt, { file: "x", values: ["", RELATIVE_HOOKS] }).deny).toBe(true);
  });
});

// The reader's failure paths, with git injected so each exit status is exercised deterministically
// (the measured statuses: absent key -> 1; malformed config, or rev-parse outside a repository -> 128).
// The patched reader takes { run, exists } with defaults, which Function.length does not count, so the
// patch is detected by decideAgent's arity: both changes ship in the one patch file.
describe("readSharedHooksPath distinguishes an absent key from a read it could not finish (owner patch)", () => {
  const PATCHED = decideAgent.length >= 2;
  const fail = (status) => {
    const e = new Error(`git exit ${status}`);
    e.status = status;
    return e;
  };
  const answer = (configResult) => (args) => {
    if (args[0] === "rev-parse") return ".git";
    if (configResult instanceof Error) throw configResult;
    return configResult;
  };
  it.skipIf(!PATCHED)("rev-parse failing (not a repository, malformed config) yields null", () => {
    expect(readSharedHooksPath("/x", { run: () => { throw fail(128); }, exists: () => true })).toBeNull();
  });
  it.skipIf(!PATCHED)("a missing shared config file is a read failure (values null), not an absent key", () => {
    const r = readSharedHooksPath("/x", { run: answer(""), exists: () => false });
    expect(r.values).toBeNull();
    expect(r.error).toMatch(/missing/);
  });
  it.skipIf(!PATCHED)("exit 1 is the absent key: the only value that reads as nothing to protect", () => {
    expect(readSharedHooksPath("/x", { run: answer(fail(1)), exists: () => true }).values).toEqual([]);
  });
  it.skipIf(!PATCHED)("exit 128 (malformed config) is a read failure that names its status", () => {
    const r = readSharedHooksPath("/x", { run: answer(fail(128)), exists: () => true });
    expect(r.values).toBeNull();
    expect(r.error).toMatch(/128/);
  });
  it.skipIf(!PATCHED)("a spawn error with no status (ENOENT) is a read failure too", () => {
    const enoent = new Error("spawn git ENOENT");
    enoent.code = "ENOENT";
    const r = readSharedHooksPath("/x", { run: answer(enoent), exists: () => true });
    expect(r.values).toBeNull();
    expect(r.error).toMatch(/ENOENT/);
  });
  // PR #679 exact-head review (P1, 2026-10-22): the first patch split the output on newlines and dropped
  // empty lines, so a PRESENT-but-empty key (`hooksPath =`; git prints one empty line and exits 0) read
  // as `[]`, the one shape that allows. Pinned RED against that patch first (injected "" -> values [] /
  // deny false; real git `core.hooksPath ""` -> values [] / deny false), then the reader moved to
  // `--get-all -z`, where every value ends in NUL and an empty one is a lone NUL: present-empty reads
  // [""] and denies, absent stays [] (exit 1), and a success that carries no NUL-terminated value is a
  // read failure. Three shapes, kept apart.
  it.skipIf(!PATCHED)("a present-but-empty key is a value ([\"\"]) that denies, never the absence that allows", () => {
    const r = readSharedHooksPath("/x", { run: answer("\0"), exists: () => true });
    expect(r.values).toEqual([""]);
    const v = decideAgent(wtInput(), r);
    expect(v.deny).toBe(true);
    expect(v.reason).toMatch(/present but empty/);
  });
  it.skipIf(!PATCHED)("a success that prints no NUL-terminated value is a read failure, not an absence", () => {
    const r = readSharedHooksPath("/x", { run: answer(""), exists: () => true });
    expect(r.values).toBeNull();
    expect(r.error).toMatch(/no NUL-terminated value/);
    expect(decideAgent(wtInput(), r).deny).toBe(true);
  });
  it.skipIf(!PATCHED)("a successful read returns every value in order, NUL-terminated, empties kept", () => {
    expect(readSharedHooksPath("/x", { run: answer(`${RELATIVE_HOOKS}\0C:\\x\\.githooks\0`), exists: () => true }).values)
      .toEqual([RELATIVE_HOOKS, "C:\\x\\.githooks"]);
    expect(readSharedHooksPath("/x", { run: answer(`\0${RELATIVE_HOOKS}\0`), exists: () => true }).values)
      .toEqual(["", RELATIVE_HOOKS]);
  });
  it.skipIf(!PATCHED)("end to end on real git: a malformed shared config reads as null and the worktree stays denied", () => {
    const dir = mkdtempSync(join(tmpdir(), "hookspath-guard-badcfg-"));
    try {
      execFileSync("git", ["init", "-q", dir], { encoding: "utf8" });
      writeFileSync(join(dir, ".git", "config"), "[core\n\tbare = false\n", "utf8");
      const shared = readSharedHooksPath(dir);
      expect(shared).toBeNull();
      expect(decideAgent(wtInput(), shared).deny).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  const wtInput = () => ({ subagent_type: "Explore", isolation: "worktree" });
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

  // The reviewer's "empty success" on real git: `git config core.hooksPath ""` writes `hooksPath =`, and
  // `--get-all` then exits 0 with an empty value. Under the owner patch that is [""], never [].
  it.skipIf(decideAgent.length < 2)("a present-but-empty shared key reads as [\"\"] on real git: the worktree stays denied, nothing is rewritten", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    const f = fixture();
    f.git(["config", "core.hooksPath", ""]);
    const shared = readSharedHooksPath(f.dir);
    expect(shared.values).toEqual([""]);
    expect(decideAgent({ subagent_type: "Explore", isolation: "worktree" }, shared).deny).toBe(true);
    expect(restoreSharedHooksPath(f.dir)).toMatchObject({ restored: false, values: [""] });
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
