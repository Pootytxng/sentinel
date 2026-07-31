// Guard 2 — "expected 300000 while the effective value is 150000", both directions.
//
// Why (spec §2 finding 3, §5.2): `.claude/settings.json` is TRACKED branch content, and
// CLAUDE_CODE_AUTO_COMPACT_WINDOW is 300000 on the sentinel-feedback branch and 150000 on the
// other five. Opening the wrong folder silently changes the context window — no mistake is required
// beyond opening the wrong door, and that is exactly how the 300k claim in #14 was invalidated.
//
// Two-sided on purpose: a guard that only catches "too small" would happily let the 300k marathon
// tier leak into an unrelated train, which is the failure the owner explicitly forbade
// ("do not globally adopt the 300k window merely to conceal routing mistakes"). Acceptance of the
// tier (#19, 2026-07-31) did not relax that — accepted is not default.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  compareWindow,
  intendedWindow,
  resolveSettings,
  resolveWindow,
} from "./settings-resolve.mjs";

const POLICY = {
  default: 150000,
  tiers: [{ window: 300000, issues: [15, 16], note: "the accepted marathon tier, scoped per issue" }],
};

let root;
const dirs = {};

const mkSettings = (name, project, local = null, home = null) => {
  const dir = join(root, name);
  mkdirSync(join(dir, ".claude"), { recursive: true });
  if (project) writeFileSync(join(dir, ".claude", "settings.json"), JSON.stringify(project, null, 2));
  if (local) writeFileSync(join(dir, ".claude", "settings.local.json"), JSON.stringify(local, null, 2));
  if (home) {
    mkdirSync(join(dir, "_home", ".claude"), { recursive: true });
    writeFileSync(join(dir, "_home", ".claude", "settings.json"), JSON.stringify(home, null, 2));
  }
  dirs[name] = dir;
  return dir;
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "compy-entry-settings-"));

  // The five 150000 worktrees.
  mkSettings("standard", { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "150000", CLAUDE_CODE_SUBAGENT_MODEL: "sonnet" } });
  // The sentinel-feedback branch.
  mkSettings("feedback", { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "300000", CLAUDE_CODE_SUBAGENT_MODEL: "sonnet" } });
  // A folder with no project settings at all.
  mkSettings("bare", null);
  // Local overlay beats project.
  mkSettings(
    "overlaid",
    { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "150000" } },
    { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "300000" } },
  );
  // User settings are the weakest file layer.
  mkSettings(
    "homeOnly",
    null,
    null,
    { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "222000", CLAUDE_CODE_SUBAGENT_MODEL: "opus" } },
  );
  // A typo'd value must be ignored AND reported, never silently coerced.
  mkSettings("typo", { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "300k" } });
});

afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* locked file on Windows must not fail the suite */
  }
});

describe("layered resolution reports provenance, not just a number", () => {
  it("names the exact file a value came from — that file path IS the remediation", () => {
    const r = resolveWindow({ dir: dirs.standard, env: {} });
    expect(r.window).toBe(150000);
    expect(r.source).toBe("settings");
    expect(r.file).toBe(join(dirs.standard, ".claude", "settings.json"));
  });

  it("local settings override project settings", () => {
    const r = resolveWindow({ dir: dirs.overlaid, env: {} });
    expect(r.window).toBe(300000);
    expect(r.file).toBe(join(dirs.overlaid, ".claude", "settings.local.json"));
  });

  it("project settings override user settings", () => {
    const r = resolveWindow({ dir: dirs.standard, home: join(dirs.homeOnly, "_home"), env: {} });
    expect(r.window).toBe(150000);
    expect(r.file).toBe(join(dirs.standard, ".claude", "settings.json"));
  });

  it("falls back to user settings when the project defines nothing", () => {
    const r = resolveWindow({ dir: dirs.bare, home: join(dirs.homeOnly, "_home"), env: {} });
    expect(r.window).toBe(222000);
    expect(r.file).toBe(join(dirs.homeOnly, "_home", ".claude", "settings.json"));
  });

  it("the process environment beats every file, because that is what a live session runs on", () => {
    const r = resolveWindow({ dir: dirs.feedback, env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "150000" } });
    expect(r.window).toBe(150000);
    expect(r.source).toBe("env");
  });

  it("reports the documented fallback as a fallback, never as configuration", () => {
    const r = resolveWindow({ dir: dirs.bare, home: join(root, "no-such-home"), env: {} });
    expect(r.window).toBe(150000);
    expect(r.source).toBe("fallback");
    expect(r.configured).toBe(false);
  });

  it("ignores an unparseable value and says so, rather than quietly coercing it", () => {
    const r = resolveWindow({ dir: dirs.typo, env: {} });
    expect(r.configured).toBe(false);
    expect(r.ignored.map((i) => i.value)).toContain("300k");
  });

  it("resolves other settings with provenance too, not just the window", () => {
    const s = resolveSettings({ dir: dirs.standard, home: join(dirs.homeOnly, "_home"), env: {} });
    expect(s.envValues.CLAUDE_CODE_SUBAGENT_MODEL).toMatchObject({ value: "sonnet" });
    expect(s.envValues.CLAUDE_CODE_SUBAGENT_MODEL.source).toBe(
      join(dirs.standard, ".claude", "settings.json"),
    );
  });
});

describe("the window comes from policy per train, never from whichever folder was opened", () => {
  it("this train (#18) is a default-window train", () => {
    expect(intendedWindow(POLICY, { issue: 18 })).toMatchObject({ window: 150000 });
  });

  it("the 300k marathon tier stays scoped to its own issues", () => {
    expect(intendedWindow(POLICY, { issue: 15 }).window).toBe(300000);
    expect(intendedWindow(POLICY, { issue: 16 }).window).toBe(300000);
    expect(intendedWindow(POLICY, { issue: 17 }).window).toBe(150000);
  });

  it("gives a reason, so the number is never unexplained", () => {
    expect(intendedWindow(POLICY, { issue: 15 }).reason).toMatch(/marathon/i);
    expect(intendedWindow(POLICY, { issue: 18 }).reason).toMatch(/default/i);
  });

  it("flags the marathon tier as such, and everything else as standard", () => {
    expect(intendedWindow(POLICY, { issue: 15 }).marathon).toBe(true);
    expect(intendedWindow(POLICY, { issue: 18 }).marathon).toBe(false);
  });
});

describe("guard 2 — the comparison, in both directions", () => {
  it("refuses when the effective window is SMALLER than the train intends", () => {
    const c = compareWindow(intendedWindow(POLICY, { issue: 15 }), resolveWindow({ dir: dirs.standard, env: {} }));
    expect(c.ok).toBe(false);
    expect(c.expected).toBe(300000);
    expect(c.actual).toBe(150000);
  });

  it("refuses when the effective window is LARGER than the train intends", () => {
    // The #14 failure, inverted: opening the feedback folder for a standard-tier train would
    // silently adopt 300k. Refusing here is what keeps the marathon tier scoped.
    const c = compareWindow(intendedWindow(POLICY, { issue: 18 }), resolveWindow({ dir: dirs.feedback, env: {} }));
    expect(c.ok).toBe(false);
    expect(c.expected).toBe(150000);
    expect(c.actual).toBe(300000);
  });

  it("names the file and the key in the remediation, not just the mismatch", () => {
    const c = compareWindow(intendedWindow(POLICY, { issue: 18 }), resolveWindow({ dir: dirs.feedback, env: {} }));
    expect(c.remediation).toContain("CLAUDE_CODE_AUTO_COMPACT_WINDOW");
    expect(c.remediation).toContain(join(dirs.feedback, ".claude", "settings.json"));
  });

  it("passes when they agree", () => {
    expect(compareWindow(intendedWindow(POLICY, { issue: 18 }), resolveWindow({ dir: dirs.standard, env: {} })).ok).toBe(true);
    expect(compareWindow(intendedWindow(POLICY, { issue: 15 }), resolveWindow({ dir: dirs.feedback, env: {} })).ok).toBe(true);
  });

  it("refuses an unconfigured window even when the fallback happens to match", () => {
    // 150000 by accident is not 150000 by decision. "Resolved intentionally per policy" means the
    // value has to be configured, not coincidental.
    const c = compareWindow(intendedWindow(POLICY, { issue: 18 }), resolveWindow({ dir: dirs.bare, home: join(root, "nope"), env: {} }));
    expect(c.actual).toBe(150000);
    expect(c.ok).toBe(false);
    expect(c.remediation).toMatch(/not configured/i);
  });
});
