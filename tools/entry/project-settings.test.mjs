// Guard: a settings file the launcher could not read is not a settings file that configures nothing.
//
// `readProjectWindow` returned the same `null` for four different situations: absent, unreadable,
// malformed, and present-but-setting-no-window. Only the last means "configures nothing". `planTier`
// then treated a folder whose tracked settings it had FAILED TO READ as unconfigured, and wrote a
// local override on top of it — while the `settings.window` row passed.
//
// Establishing a tier over settings you could not read is the one move the whole ownership record
// exists to prevent, done to the tracked layer instead of the local one.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { planTier, readProjectSettings, readProjectWindow } from "./tier.mjs";

const MARATHON = { window: 300000, reason: "marathon tier, scoped to this issue" };
let dir;

const settings = (text) => {
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, ".claude", "settings.json"), text);
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "compy-proj-settings-"));
});
afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* a locked file on Windows must not fail the suite */
  }
});

describe("telling the four situations apart", () => {
  it("absent is readable and configures nothing", () => {
    expect(readProjectSettings(dir)).toEqual({ window: null, readable: true, reason: null });
  });

  it("present and setting a window reports the window", () => {
    settings(JSON.stringify({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "150000" } }));
    expect(readProjectSettings(dir)).toMatchObject({ window: 150000, readable: true });
  });

  it("present and setting no window is readable, and still nothing", () => {
    settings(JSON.stringify({ permissions: { allow: [] } }));
    expect(readProjectSettings(dir)).toEqual({ window: null, readable: true, reason: null });
  });

  // The one that used to be indistinguishable from the case above.
  it("malformed is NOT readable, and says why", () => {
    settings("{ this is not json");
    const r = readProjectSettings(dir);
    expect(r.readable).toBe(false);
    expect(r.reason).toMatch(/not valid JSON/);
  });

  it("the number-only helper still answers for callers that only wanted the number", () => {
    settings(JSON.stringify({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "300000" } }));
    expect(readProjectWindow(dir)).toBe(300000);
  });
});

describe("what the plan does about it", () => {
  it("refuses to establish a tier over settings it could not read", () => {
    const p = planTier({ intended: MARATHON, projectReadable: false, projectReason: "x/.claude/settings.json is not valid JSON" });
    expect(p.action).toBe("refuse");
    expect(p.reason).toMatch(/not valid JSON/);
    expect(p.reason).toMatch(/cannot tell what this folder already configures/);
  });

  it("still writes when the tracked settings are readable and simply configure nothing", () => {
    expect(planTier({ intended: MARATHON, projectWindow: null, projectReadable: true }).action).toBe("write");
  });
});
