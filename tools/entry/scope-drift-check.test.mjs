// Guard for .claude/hooks/scope-drift-check.mjs (#356): the warn-only PostToolUse half of the
// write-scope backstop. The decision is proven over facts; the IO shell is proven against a real
// temporary lineage store, a real temporary claim cache and a fake git, because the hook's whole
// value is in what it reads, and a test that injects the answer proves only the formatting.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { canonicalizePath, writeLineage } from "../../.claude/hooks/session-root-assert.mjs";
import { OFF_SWITCH, REMIND_EVERY_MS, decide, emit, readMemo, run } from "../../.claude/hooks/scope-drift-check.mjs";
import { writeClaimCache } from "../../scripts/lib/scope-drift.mjs";

const ROOT = resolve(process.cwd());
const read = (rel) => readFileSync(join(ROOT, ...rel.split("/")), "utf8");
const claim = { issue: 1, scope: ["docs/", "scripts/"], folder: null };
const now = new Date("2026-09-02T12:00:00Z");

describe("decide", () => {
  it("is silent without a claim, with a path-less scope, and when every change is inside", () => {
    expect(decide({ issue: 1, claim: null, changed: ["src/x.ts"], now }).emit).toBe(false);
    expect(decide({ issue: 1, claim: { scope: [] }, changed: ["src/x.ts"], now }).emit).toBe(false);
    expect(decide({ issue: 1, claim, changed: ["docs/a.md", "scripts/b.mjs"], now }).emit).toBe(false);
  });

  it("reports a changed path outside the claim, with the cure", () => {
    const v = decide({ issue: 1, claim, changed: ["docs/a.md", "src/x.ts"], now });
    expect(v.emit).toBe(true);
    expect(v.outside).toEqual(["src/x.ts"]);
    expect(v.message).toContain("  - src/x.ts");
    expect(v.message).toContain("#1");
    expect(v.message).toContain("cure:");
    expect(v.memo).toEqual({ outside: ["src/x.ts"], at: now.toISOString() });
  });

  it("does not repeat the same finding within the reminder window, and does once the window passes", () => {
    const first = decide({ issue: 1, claim, changed: ["src/x.ts"], now });
    const again = decide({ issue: 1, claim, changed: ["src/x.ts"], memo: first.memo, now: new Date(now.getTime() + 1000) });
    expect(again.emit).toBe(false);
    expect(again.reason).toBe("already reported");
    const later = decide({ issue: 1, claim, changed: ["src/x.ts"], memo: first.memo, now: new Date(now.getTime() + REMIND_EVERY_MS) });
    expect(later.emit).toBe(true);
  });

  it("a changed set of drifting paths is a new finding, immediately", () => {
    const first = decide({ issue: 1, claim, changed: ["src/x.ts"], now });
    const more = decide({ issue: 1, claim, changed: ["src/x.ts", "src-tauri/src/lib.rs"], memo: first.memo, now: new Date(now.getTime() + 1000) });
    expect(more.emit).toBe(true);
    expect(more.outside).toEqual(["src/x.ts", "src-tauri/src/lib.rs"]);
  });

  it("a stale claim is said to be stale", () => {
    const v = decide({ issue: 1, claim: { ...claim, stale: true }, changed: ["src/x.ts"], now });
    expect(v.message).toContain("stale cache");
  });
});

describe("run — the IO shell over a real lineage store, a real cache and a fake git", () => {
  let dir;
  let cacheDir;
  let root;
  let statusOut = "?? src/x.ts\0";
  const git = (cwd, args) => {
    if (args[0] === "status") return statusOut;
    if (args[0] === "rev-parse") return "";
    if (args[0] === "diff") return "";
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
  const env = () => ({ CLAUDE_PROJECT_DIR: root });
  const hookInput = () => ({ session_id: "s-1", tool_name: "Bash", tool_input: { command: "echo" }, cwd: root });

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "compy-drift-lineage-"));
    cacheDir = mkdtempSync(join(tmpdir(), "compy-drift-cache-"));
    root = mkdtempSync(join(tmpdir(), "compy-drift-root-"));
    writeLineage(
      { issue: 777, folder: canonicalizePath(root), branch: "lane/x", sessionId: "s-1", lastSeenAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3_600_000).toISOString() },
      { dir },
    );
    writeClaimCache({ issue: 777, scopeText: "`docs/`", folder: root, branch: "lane/x" }, { dir: cacheDir, now });
  });
  afterAll(() => {
    for (const d of [dir, cacheDir, root]) rmSync(d, { recursive: true, force: true });
  });

  it("reports drift once, remembers it, and repeats only when the set changes or the window passes", () => {
    const first = run({ hookInput: hookInput(), env: env(), dir, cacheDir, now, git });
    expect(first).toContain("  - src/x.ts");
    expect(readMemo({ issue: 777, cacheDir })?.outside).toEqual(["src/x.ts"]);

    expect(run({ hookInput: hookInput(), env: env(), dir, cacheDir, now: new Date(now.getTime() + 5000), git })).toBeNull();

    statusOut = "?? src/x.ts\0?? src/y.ts\0";
    expect(run({ hookInput: hookInput(), env: env(), dir, cacheDir, now: new Date(now.getTime() + 6000), git })).toContain("  - src/y.ts");

    expect(run({ hookInput: hookInput(), env: env(), dir, cacheDir, now: new Date(now.getTime() + 6000 + REMIND_EVERY_MS), git })).toContain("  - src/x.ts");
  });

  it("is silent when the tree is back inside the claim, and clears the memo so the next drift is fresh", () => {
    statusOut = " M docs/a.md\0";
    expect(run({ hookInput: hookInput(), env: env(), dir, cacheDir, now: new Date(now.getTime() + 7000), git })).toBeNull();
    expect(readMemo({ issue: 777, cacheDir })?.outside).toEqual([]);
    statusOut = "?? src/x.ts\0";
    expect(run({ hookInput: hookInput(), env: env(), dir, cacheDir, now: new Date(now.getTime() + 8000), git })).toContain("  - src/x.ts");
  });

  it("is silent under the off switch, without a session record, and when the claim names another folder", () => {
    expect(run({ hookInput: hookInput(), env: { ...env(), [OFF_SWITCH]: "1" }, dir, cacheDir, now, git })).toBeNull();
    const emptyDir = mkdtempSync(join(tmpdir(), "compy-drift-empty-"));
    try {
      expect(run({ hookInput: hookInput(), env: env(), dir: emptyDir, cacheDir, now, git })).toBeNull();
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
    writeClaimCache({ issue: 777, scopeText: "`docs/`", folder: join(root, "elsewhere") }, { dir: cacheDir, now });
    expect(run({ hookInput: hookInput(), env: env(), dir, cacheDir, now: new Date(now.getTime() + 9000), git })).toBeNull();
    writeClaimCache({ issue: 777, scopeText: "`docs/`", folder: root }, { dir: cacheDir, now });
  });

  it("re-reads the thread only once the cache is stale, and keeps the stale cache when the thread is down", () => {
    let asked = 0;
    const thread = () => (asked++, { claim: { scope: "`docs/`, `src/`", folder: root, branch: "lane/x" } });
    // A new drifting set, so the finding is fresh rather than "already reported" from the test above.
    statusOut = "?? src/z.ts\0";
    expect(run({ hookInput: hookInput(), env: env(), dir, cacheDir, now: new Date(now.getTime() + 10_000), git, thread })).toContain("src/z.ts");
    expect(asked).toBe(0);
    const later = new Date(now.getTime() + 11 * 60_000);
    // Past the TTL: the thread is read, the claim now covers src/, and the finding clears.
    expect(run({ hookInput: hookInput(), env: env(), dir, cacheDir, now: later, git, thread })).toBeNull();
    expect(asked).toBe(1);
    const down = () => {
      throw new Error("offline");
    };
    const muchLater = new Date(later.getTime() + 11 * 60_000);
    expect(run({ hookInput: hookInput(), env: env(), dir, cacheDir, now: muchLater, git, thread: down })).toBeNull();
  });
});

describe("the wire", () => {
  it("emits PostToolUse additionalContext and never a permission decision", () => {
    let out = "";
    expect(emit("hello", { write: (s) => (out += s) })).toBe(0);
    const parsed = JSON.parse(out);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(parsed.hookSpecificOutput.additionalContext).toBe("hello");
    expect(out).not.toContain("permissionDecision");
    out = "";
    expect(emit(null, { write: (s) => (out += s) })).toBe(0);
    expect(out).toBe("");
  });

  it("is registered for every tool that can change the tree", () => {
    const settings = JSON.parse(read(".claude/settings.json"));
    const entry = (settings.hooks?.PostToolUse ?? []).find((e) => e.hooks?.some((h) => String(h.command).includes("scope-drift-check.mjs")));
    expect(entry, "scope-drift-check.mjs is not registered under PostToolUse").toBeTruthy();
    for (const tool of ["Bash", "PowerShell", "Write", "Edit", "MultiEdit", "NotebookEdit"]) {
      expect(new RegExp(`(^|\\|)${tool}(\\||$)`).test(entry.matcher), `matcher does not cover ${tool}`).toBe(true);
    }
  });

  it("the hook source is warn-only and fails open", () => {
    const src = read(".claude/hooks/scope-drift-check.mjs");
    expect(src).not.toContain("permissionDecision");
    expect(src).toContain('hookEventName: "PostToolUse"');
    expect(src).toContain(`export const OFF_SWITCH = "${OFF_SWITCH}"`);
    expect(src).toMatch(/catch \{\s*process\.exit\(0\)/);
  });
});
