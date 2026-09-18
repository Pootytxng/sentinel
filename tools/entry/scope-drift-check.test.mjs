// Guard for .claude/hooks/scope-drift-check.mjs (#356): the warn-only PostToolUse half of the
// write-scope backstop. The decision is proven over facts; the IO shell is proven against a real
// temporary lineage store, a real temporary claim cache and a fake git, because the hook's whole
// value is in what it reads, and a test that injects the answer proves only the formatting.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { canonicalizePath, writeLineage } from "../../.claude/hooks/session-root-assert.mjs";
import { OFF_SWITCH, REMIND_EVERY_MS, claimFor, decide, emit, readMemo, run } from "../../.claude/hooks/scope-drift-check.mjs";
// The whole module too, for an export that exists only once the owner applies the #465 patch.
import * as hook from "../../.claude/hooks/scope-drift-check.mjs";
import { resolveClaim } from "../../scripts/scope-drift-gate.mjs";
import { CACHE_TTL_MS, readClaimCache, writeClaimCache } from "../../scripts/lib/scope-drift.mjs";

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

// #465. #459 (PR #462) taught the gate's resolveClaim that a thread which was READ and holds no live
// claim outvotes the cache: the copy is dropped and nothing is measured. claimFor kept the old
// fallback, so after a Handoff released a claim this hook went on judging edits against the released
// scope. Seen 2026-09-18 on #457's real thread: claimFor returned the released claim's cached scope,
// resolveClaim returned vacant. The fix is in a hook entrypoint, which is owner-hands (#368), so it
// ships as a patch. The apply-check keeps the patch applicable until it lands; the tests behind
// `skipIf` run from the moment it has, and the last of them holds the hook and the gate to one reading
// of a thread, so a fix to one of the two copies can no longer leave the other behind.
describe("#465: a thread read with no live claim is vacant for the hook, as it is for the gate (#459)", () => {
  const REPO = join(import.meta.dirname, "..", "..");
  const PATCH = join(REPO, "docs", "superpowers", "specs", "2026-09-18-scope-drift-hook-released-claim.patch");
  const applied = hook.VACANT !== undefined;
  const NOW = new Date("2026-09-18T05:01:00Z");
  const STALE = new Date(NOW.getTime() - CACHE_TTL_MS - 60_000);
  const RELEASED = { claim: null, handoff: { released: true, postedAt: "2026-09-18T03:29:00Z" }, unreadable: false };
  let base;
  const scratch = () => mkdtempSync(join(base, "c-"));

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), "compy-drift465-"));
  });
  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("the owner-hand patch still applies to the hook as it is — and is gone once applied", () => {
    if (applied) {
      expect(existsSync(PATCH), "the patch is spent: delete it in the same commit that applies it").toBe(false);
      return;
    }
    expect(existsSync(PATCH), "the patch this block names must exist until it is applied").toBe(true);
    expect(() => execFileSync("git", ["apply", "--check", PATCH], { cwd: REPO, stdio: "pipe" })).not.toThrow();
  });

  // Live now and after the patch: the fix must not reach this case.
  it("a thread that could not be read is not a released one: the stale cache stands, labelled stale, and is kept", () => {
    const reads = [
      ["unreadable: true", () => ({ claim: null, handoff: null, unreadable: true })],
      ["a throw", () => {
        throw new Error("offline");
      }],
      ["no answer", () => undefined],
    ];
    for (const [name, thread] of reads) {
      const dir = scratch();
      writeClaimCache({ issue: 465, scopeText: "`docs/`" }, { dir, now: STALE });
      const c = claimFor({ issue: 465, cacheDir: dir, now: NOW, thread });
      expect(c?.scope, name).toEqual(["docs"]);
      expect(c?.stale, name).toBe(true);
      expect(readClaimCache({ issue: 465, dir }), name).not.toBeNull();
    }
  });

  describe.skipIf(!applied)("once applied", () => {
    it("a released claim: the thread outvotes the stale cache, the answer is VACANT, and the copy is dropped", () => {
      const dir = scratch();
      // The cache #457's released claim left behind in the reproduction.
      writeClaimCache({ issue: 465, scopeText: "`docs/`, `scripts/`, `src/`" }, { dir, now: STALE });
      expect(claimFor({ issue: 465, cacheDir: dir, now: NOW, thread: () => RELEASED })).toBe(hook.VACANT);
      expect(readClaimCache({ issue: 465, dir })).toBeNull();
    });

    it("a thread that never held a claim is vacant too, with a cache or without one: the read decides, not the Handoff", () => {
      for (const read of [{ claim: null }, { claim: null, handoff: null, unreadable: false }]) {
        const dir = scratch();
        writeClaimCache({ issue: 465, scopeText: "`docs/`" }, { dir, now: STALE });
        expect(claimFor({ issue: 465, cacheDir: dir, now: NOW, thread: () => read })).toBe(hook.VACANT);
        expect(readClaimCache({ issue: 465, dir })).toBeNull();
        expect(claimFor({ issue: 465, cacheDir: scratch(), now: NOW, thread: () => read })).toBe(hook.VACANT);
      }
    });

    it("VACANT measures nothing, even for a caller that forgets to check for it", () => {
      expect(Object.isFrozen(hook.VACANT)).toBe(true);
      expect(decide({ issue: 465, claim: hook.VACANT, changed: ["src/x.ts"], now: NOW }).emit).toBe(false);
    });

    it("run(): the same stale cache still warns when the thread is unreadable, and goes quiet once the thread says the claim is over", () => {
      const dir = scratch();
      const cacheDir = scratch();
      const root = scratch();
      writeLineage(
        { issue: 465, folder: canonicalizePath(root), branch: "lane/x", sessionId: "s-465", lastSeenAt: NOW.toISOString(), expiresAt: new Date(NOW.getTime() + 3_600_000).toISOString() },
        { dir },
      );
      // The released claim covered docs/ only; the tree has a change outside it.
      writeClaimCache({ issue: 465, scopeText: "`docs/`", folder: root, branch: "lane/x" }, { dir: cacheDir, now: STALE });
      let gitCalls = 0;
      const git = (cwd, args) => (gitCalls++, args[0] === "status" ? "?? src/x.ts\0" : "");
      const input = { session_id: "s-465", tool_name: "Bash", tool_input: { command: "echo" }, cwd: root };
      const at = (now, thread) => run({ hookInput: input, env: { CLAUDE_PROJECT_DIR: root }, dir, cacheDir, now, git, thread });
      let asked = 0;
      const counted = (read) => () => (asked++, read);
      // The control: this setup does report drift, so the silence below is the fix and not a miss.
      const warned = at(NOW, counted({ claim: null, handoff: null, unreadable: true }));
      expect(warned).toContain("  - src/x.ts");
      expect(warned).toContain("stale cache");
      const measured = gitCalls;
      expect(measured).toBeGreaterThan(0);
      // One reminder window later, so the memo cannot be what silences the old code here.
      expect(at(new Date(NOW.getTime() + REMIND_EVERY_MS), counted(RELEASED))).toBeNull();
      expect(asked).toBe(2);
      expect(readClaimCache({ issue: 465, dir: cacheDir })).toBeNull();
      // Nothing to measure, so nothing is measured: no claim, no `git status`.
      expect(gitCalls).toBe(measured);
    });

    // Every way a thread read comes back, from every state the cache can be in. The gate is read on
    // its pre-push path (online, no --refresh), which consults the thread exactly when the hook does.
    it("the hook and the gate read every thread the same way, from every cache state", () => {
      const reads = {
        "a live claim": () => ({ claim: { scope: "`tools/`", folder: null, branch: null }, handoff: null, unreadable: false }),
        "a released claim": () => RELEASED,
        "a thread that never held a claim": () => ({ claim: null, handoff: null, unreadable: false }),
        "a live claim with no scope text": () => ({ claim: { scope: null }, handoff: null, unreadable: false }),
        "an unreadable thread": () => ({ claim: null, handoff: null, unreadable: true }),
        "a thread that throws": () => {
          throw new Error("offline");
        },
        "a thread that answers nothing": () => undefined,
      };
      const caches = { "no cache": null, "a stale cache": STALE, "a fresh cache": NOW };
      const posture = (readerDir, c) => ({
        vacant: c.vacant,
        scope: c.scope,
        stale: c.stale,
        cacheKept: readClaimCache({ issue: 465, dir: readerDir }) !== null,
      });
      const hookRead = (dir, thread) => {
        const c = claimFor({ issue: 465, cacheDir: dir, now: NOW, thread });
        const claim = c === hook.VACANT ? null : c;
        return posture(dir, { vacant: c === hook.VACANT, scope: claim?.scope ?? null, stale: Boolean(claim?.stale) });
      };
      const gateRead = (dir, thread) => {
        const r = resolveClaim({ issue: 465, cacheDir: dir, now: NOW, thread });
        return posture(dir, { vacant: r.vacant === true, scope: r.claim?.scope ?? null, stale: Boolean(r.claim && r.stale) });
      };
      const table = (reader) => {
        const out = {};
        for (const [cacheName, cachedAt] of Object.entries(caches)) {
          for (const [readName, thread] of Object.entries(reads)) {
            const dir = scratch();
            if (cachedAt) writeClaimCache({ issue: 465, scopeText: "`docs/`" }, { dir, now: cachedAt });
            out[`${cacheName}, ${readName}`] = reader(dir, thread);
          }
        }
        return out;
      };
      expect(table(hookRead)).toEqual(table(gateRead));
    });
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
