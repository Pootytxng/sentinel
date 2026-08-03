// Guard: what a hook IS, not where it is.
//
// Three claims the repair path made and could not support:
//
//   7a  `isTracked` asked "is this path in the index" and repair then copied whatever bytes were on
//       disk. A tracked file somebody had edited passed, and its uncommitted content was installed
//       into a worktree as "the versioned control payload" — an unreviewed hook running a real
//       ALLOW/DENY. Tracked is not versioned.
//   7b  `verifyHooks` used `existsSync` as the whole health test. `.claude/hooks/` is gitignored, so
//       an old branch's copy or a hand-edit exists, runs, and reports healthy. The path being there
//       says nothing about what executes.
//   6   the repair re-measured exactly one row and spread every other pre-write fact back in, while
//       its own comment said "the FULL preflight runs again". `reconcile` is pure over what it is
//       handed, so board, folder, git, settings, claim and process state were all re-used unread.
//
// The refusals stay refusals: a divergent hook is never silently overwritten, because it may be a
// deliberate local change and the launcher does not get to decide that.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { isTracked, verifyHooks } from "./hooks-verify.mjs";
import { repairHooksIfSafe } from "./launch.mjs";

const git = (dir, args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const SETTINGS = {
  hooks: { Stop: [{ hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/stop-continue.mjs"' }] }] },
};

let root;
let repo;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "compy-entry-hook-integrity-"));
  repo = join(root, "control");
  mkdirSync(join(repo, ".claude", "hooks"), { recursive: true });
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "t@t"]);
  git(repo, ["config", "user.name", "t"]);
  writeFileSync(join(repo, ".claude", "hooks", "stop-continue.mjs"), "// the reviewed payload\n");
  git(repo, ["add", "-A", "-f"]);
  git(repo, ["commit", "-m", "seed"]);
});

afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* a locked file on Windows must not fail the suite */
  }
});

describe("7a — tracked is not versioned", () => {
  const hook = () => join(repo, ".claude", "hooks", "stop-continue.mjs");

  it("accepts a tracked file whose bytes are the committed bytes", () => {
    expect(isTracked(hook())).toBe(true);
  });

  it("refuses a tracked file that has been edited since the commit", () => {
    writeFileSync(hook(), "// the reviewed payload\nprocess.exit(0); // and something else\n");
    expect(isTracked(hook())).toBe(false);
    git(repo, ["checkout", "--", ".claude/hooks/stop-continue.mjs"]);
    expect(isTracked(hook())).toBe(true);
  });

  it("refuses a file git has never heard of", () => {
    const stray = join(repo, ".claude", "hooks", "stray.mjs");
    writeFileSync(stray, "// not in the payload\n");
    expect(isTracked(stray)).toBe(false);
  });
});

describe("7b — existing is not healthy", () => {
  let folder;

  const setup = (hookBody) => {
    folder = mkdtempSync(join(root, "wt-"));
    mkdirSync(join(folder, ".claude", "hooks"), { recursive: true });
    writeFileSync(join(folder, ".claude", "settings.json"), JSON.stringify(SETTINGS, null, 2));
    writeFileSync(join(folder, ".claude", "hooks", "stop-continue.mjs"), hookBody);
    return verifyHooks({ dir: folder, home: join(root, "no-home"), canonicalDir: join(repo, ".claude", "hooks") });
  };

  // Read the canonical bytes rather than assuming them: git may normalise line endings on checkout,
  // and the rule being guarded is "equal to the payload on disk", not "equal to a string I typed".
  it("passes a hook whose bytes match the canonical payload", () => {
    const v = setup(readFileSync(join(repo, ".claude", "hooks", "stop-continue.mjs")));
    expect(v.ok).toBe(true);
    expect(v.divergent).toEqual([]);
  });

  it("refuses a hook that exists but is not the payload — it runs, but not the reviewed code", () => {
    const v = setup("// an old branch's copy, still executing\n");
    expect(v.ok).toBe(false);
    expect(v.divergent.map((c) => c.name)).toEqual(["stop-continue.mjs"]);
    expect(v.remediation).toMatch(/not match the versioned control payload/i);
    expect(v.remediation).toMatch(/will not overwrite/i);
  });

  // Without a canonical set there is nothing to compare against, and inventing a verdict would be
  // worse than the honest silence. Existence-only stays the answer, explicitly.
  it("says nothing about divergence when it was given no canonical set", () => {
    folder = mkdtempSync(join(root, "wt-nocanon-"));
    mkdirSync(join(folder, ".claude", "hooks"), { recursive: true });
    writeFileSync(join(folder, ".claude", "settings.json"), JSON.stringify(SETTINGS, null, 2));
    writeFileSync(join(folder, ".claude", "hooks", "stop-continue.mjs"), "// anything at all\n");
    const v = verifyHooks({ dir: folder, home: join(root, "no-home") });
    expect(v.ok).toBe(true);
    expect(v.divergent).toEqual([]);
  });
});

describe("6 — the full preflight the comment promised", () => {
  const facts = () => ({
    hooks: { dir: join(root, "any"), missing: [{ name: "stop-continue.mjs", file: join(root, "any", ".claude", "hooks", "stop-continue.mjs") }] },
    board: "STALE",
  });
  const row = (name, ok) => ({ name, expected: "x", actual: "y", ok, remediation: null, note: null });

  it("uses the caller's fresh reading rather than the facts captured before the write", () => {
    const regather = vi.fn(() => ({ facts: { hooks: { ok: true, missing: [], checked: [] }, board: "FRESH" } }));
    const r = repairHooksIfSafe({
      facts: facts(),
      verdict: { checks: [row("hooks.present", false)] },
      canonicalDir: join(repo, ".claude", "hooks"),
      regather,
    });

    expect(r.attempted).toBe(true);
    expect(regather).toHaveBeenCalledTimes(1);
    expect(r.regathered).toBe(true);
    // The assertion that was false before: every non-hook fact came from the pre-write object.
    expect(r.facts.board).toBe("FRESH");
  });

  it("does not pretend to have re-gathered when it did not", () => {
    const r = repairHooksIfSafe({
      facts: facts(),
      verdict: { checks: [row("hooks.present", false)] },
      canonicalDir: join(repo, ".claude", "hooks"),
    });
    expect(r.regathered).toBeFalsy();
  });
});
