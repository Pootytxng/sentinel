// Big-read guard — proof it actually denies, and proof it stays escapable.
//
// This suite exists because the first version of the hook was DEAD: it read stdin through a
// `require("node:fs")` call inside a `.mjs` module, where `require` is undefined. The ReferenceError
// was swallowed by the hook's own fail-open catch, so it exited 0 on every single invocation and
// blocked nothing. A suite that only asserted "allow" cases would have passed over that corpse
// happily. So the FIRST case here is a deny, and it is the case that proves the hook runs at all.
//
// Everything is driven the way the harness drives it — a real `node` child, the payload on stdin,
// the decision parsed off stdout — against fixtures written to a temp dir. Deliberately NOT against
// a repo file: pinning "docs/BACKLOG.md is big" would make this suite fail the day someone finally
// archives it, which is the exact outcome the guard is trying to encourage.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = join(ROOT, ".claude", "hooks", "big-read-guard.mjs");
const SETTINGS = join(ROOT, ".claude", "settings.json");

/** Run the hook exactly as the harness does: JSON on stdin, decision on stdout, always exit 0. */
function runHook(payload) {
  const res = spawnSync(process.execPath, [HOOK], {
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    encoding: "utf8",
  });
  expect(res.error, "the hook failed to spawn").toBeUndefined();
  expect(res.status, `hook exited ${res.status}; stderr: ${res.stderr}`).toBe(0);
  const out = (res.stdout || "").trim();
  return { decision: out ? JSON.parse(out).hookSpecificOutput : null, stderr: res.stderr };
}

const read = (payload) => runHook({ tool_name: "Read", tool_input: payload });

let dir;
let bigTxt;
let bigPng;
let smallTxt;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "big-read-guard-"));
  // 1000 lines × ~61 bytes ≈ 61 KB: over the byte budget, under the Read line cap, so the hook
  // reports an exact size rather than a floor.
  const big = `${"x".repeat(60)}\n`.repeat(1000);
  bigTxt = join(dir, "big.md");
  bigPng = join(dir, "big.png");
  smallTxt = join(dir, "small.md");
  writeFileSync(bigTxt, big, "utf8");
  writeFileSync(bigPng, big, "utf8");
  writeFileSync(smallTxt, "tiny\n", "utf8");
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("big-read guard", () => {
  it("denies an unbounded Read of a file past the budget", () => {
    const { decision } = read({ file_path: bigTxt });
    expect(decision, "no decision on stdout — the hook is failing open on every call").not.toBeNull();
    expect(decision.hookEventName).toBe("PreToolUse");
    expect(decision.permissionDecision).toBe("deny");
  });

  it("allows the same file once an explicit limit is passed", () => {
    expect(read({ file_path: bigTxt, limit: 200 }).decision).toBeNull();
  });

  it("allows the same file once an offset is passed", () => {
    expect(read({ file_path: bigTxt, offset: 400 }).decision).toBeNull();
  });

  it("allows a file under the budget", () => {
    expect(read({ file_path: smallTxt }).decision).toBeNull();
  });

  it("allows a path that does not exist — the Read tool owns that error, not this hook", () => {
    expect(read({ file_path: join(dir, "nope.md") }).decision).toBeNull();
  });

  it("fails open on unparseable stdin", () => {
    expect(runHook("not json at all").decision).toBeNull();
  });

  it("allows a big image — offset/limit do not apply, so a deny would be inescapable", () => {
    expect(read({ file_path: bigPng }).decision).toBeNull();
  });

  it("ignores tools that are not Read", () => {
    const { decision } = runHook({ tool_name: "Edit", tool_input: { file_path: bigTxt } });
    expect(decision).toBeNull();
  });

  it("the refusal names the file and both cheaper ways out", () => {
    const reason = read({ file_path: bigTxt }).decision.permissionDecisionReason;
    expect(reason).toContain(bigTxt);
    expect(reason).toMatch(/Grep/);
    expect(reason).toMatch(/offset/);
    expect(reason).toMatch(/limit/);
    // The measurement has to be honest or the refusal is not trustworthy: ~61 KB, 1000 lines.
    expect(reason).toMatch(/\b60 KB\b|\b59 KB\b|\b61 KB\b/);
    expect(reason).toContain("1000 lines");
  });

  it("the threshold stays in a range that means something", () => {
    // Guards get "fixed" by being defanged. 10 MB would leave this file green and useless, so the
    // budget itself is pinned: a change past these bounds has to argue with a failing test first.
    const src = readFileSync(HOOK, "utf8");
    const m = src.match(/MAX_UNBOUNDED_BYTES\s*=\s*([\d_]+)/);
    expect(m, "MAX_UNBOUNDED_BYTES is gone — the guard has no budget left").not.toBeNull();
    const bytes = Number(m[1].replace(/_/g, ""));
    expect(bytes).toBeGreaterThanOrEqual(16_000);
    expect(bytes).toBeLessThanOrEqual(96_000);
  });

  it("is wired into .claude/settings.json under a Read matcher", () => {
    const settings = JSON.parse(readFileSync(SETTINGS, "utf8"));
    const entries = settings?.hooks?.PreToolUse || [];
    const wired = entries.some(
      (e) =>
        e.matcher === "Read" &&
        (e.hooks || []).some((h) => String(h.command || "").includes("big-read-guard.mjs")),
    );
    expect(wired, "the hook exists but nothing invokes it — a file on disk guards nothing").toBe(true);
  });
});
