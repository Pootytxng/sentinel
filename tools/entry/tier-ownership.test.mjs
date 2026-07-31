// Guard: the launcher must recognise its own work after the overlay rewrites the same file.
//
// `establishTier` writes the window into `.claude/settings.local.json` and records that file's exact
// hash. `writeOverlay` then merges the marked session-root assert into THE SAME FILE and knows
// nothing about the record. So the recorded hash described a file that no longer existed the moment
// any launch finished, and the next tier CHANGE in that folder read the launcher's own file as
// somebody else's and refused: "was not written by the launcher."
//
// The earlier review recorded this as a crash window between two writes. It is not. It is the
// ordinary happy path, every launch, and it is the same mismatch that stranded the pre-sidecar
// folders whose local file carries only the overlay and no record at all.
//
// Two things close it, and both are load-bearing:
//   - ownership is also provable from CONTENT, so a file holding nothing but launcher-written
//     material is ours whatever the sidecar says;
//   - the record is re-stamped after the overlay writes, so the exact-hash proof stays the primary
//     one instead of silently degrading to the fallback on every folder.
//
// The refusal these protect is unchanged: one key of the owner's own and the file is foreign.

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ASSERT_HOOK_MARKER, writeOverlay } from "./overlay.mjs";
import {
  establishTier,
  hashOf,
  launcherOwnedOnly,
  localSettingsFile,
  planTier,
  readLocalLayer,
  readTierRecord,
  restampTier,
  tierRecordFile,
} from "./tier.mjs";

const STANDARD = { window: 150000, reason: "standard tier" };
const MARATHON = { window: 300000, reason: "marathon tier, scoped to this issue" };

let root;
let dir;
let stateDir;
let controlDir;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "compy-entry-tier-own-"));
  dir = join(root, "worktree");
  stateDir = join(root, "state");
  controlDir = join(root, "control");
  mkdirSync(join(dir, ".claude"), { recursive: true });
  mkdirSync(join(controlDir, ".claude", "hooks"), { recursive: true });
  writeFileSync(join(controlDir, ".claude", "hooks", "session-root-assert.mjs"), "// fixture\n");
});

afterEach(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* a locked file on Windows must not fail the suite */
  }
});

const record = () => readTierRecord({ dir, stateDir });

describe("the launcher's own file, after the overlay has rewritten it", () => {
  // The whole defect, end to end, in the order a real launch performs it.
  it("can still change its own tier after a launch installed the assert overlay", () => {
    expect(establishTier({ dir, intended: MARATHON, stateDir, env: {} }).wrote).toBe(true);
    expect(writeOverlay({ dir, controlDir }).wrote).toBe(true);

    // This is the assertion that failed before: the second launch reading the first launch's folder.
    const second = establishTier({ dir, intended: STANDARD, stateDir, env: {} });
    expect(second.action).not.toBe("refuse");
    expect(second.wrote).toBe(true);
    expect(readLocalLayer(dir).window).toBe(150000);
  });

  it("re-stamps the record after the overlay writes, so the exact-hash proof stays primary", () => {
    establishTier({ dir, intended: MARATHON, stateDir, env: {} });
    writeOverlay({ dir, controlDir });

    // Without the re-stamp the record describes a file that no longer exists.
    expect(restampTier({ dir, stateDir }).restamped).toBe(true);
    expect(record().hash).toBe(hashOf(readFileSync(localSettingsFile(dir), "utf8")));
    expect(record().window).toBe(300000);
  });

  it("keeps the assert overlay intact when the tier changes underneath it", () => {
    establishTier({ dir, intended: MARATHON, stateDir, env: {} });
    writeOverlay({ dir, controlDir });
    restampTier({ dir, stateDir });
    establishTier({ dir, intended: STANDARD, stateDir, env: {} });

    const data = JSON.parse(readFileSync(localSettingsFile(dir), "utf8"));
    expect(data.hooks.SessionStart.some((g) => g.hooks.some((h) => h.statusMessage === ASSERT_HOOK_MARKER))).toBe(true);
  });
});

describe("the pre-sidecar folders", () => {
  // The legacy state the review named: an overlay-only local file, written before tier records existed.
  it("adopts an overlay-only file that has no record at all", () => {
    writeOverlay({ dir, controlDir });
    expect(readTierRecord({ dir, stateDir })).toBe(null);

    const r = establishTier({ dir, intended: MARATHON, stateDir, env: {} });
    expect(r.action).toBe("write");
    expect(readLocalLayer(dir).window).toBe(300000);
  });

  it("adopts an empty local file rather than calling {} foreign", () => {
    writeFileSync(localSettingsFile(dir), "{}\n");
    expect(establishTier({ dir, intended: MARATHON, stateDir, env: {} }).action).toBe("write");
  });
});

describe("what is still not ours", () => {
  const foreign = (data) => {
    writeFileSync(localSettingsFile(dir), `${JSON.stringify(data, null, 2)}\n`);
    return planTier({ intended: MARATHON, local: readLocalLayer(dir), record: null });
  };

  it("refuses a file carrying any other env var", () => {
    expect(foreign({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "150000", MY_OWN_KEY: "1" } }).action).toBe("refuse");
  });

  it("refuses a file carrying any other top-level key", () => {
    expect(foreign({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "150000" }, permissions: { allow: ["Bash"] } }).action).toBe("refuse");
  });

  it("refuses an UNMARKED SessionStart hook — somebody else's hook is not our overlay", () => {
    expect(foreign({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "node ./mine.mjs" }] }] } }).action).toBe("refuse");
  });

  it("refuses a hook event the overlay never writes, even when marked", () => {
    expect(foreign({ hooks: { Stop: [{ hooks: [{ type: "command", command: "x", statusMessage: ASSERT_HOOK_MARKER }] }] } }).action).toBe("refuse");
  });

  // The line none of the three ownership clauses may cross: a window we did not record is the
  // owner's own pin. This is the case that made the first draft of this fix wrong.
  it("refuses a window the owner set by hand, even though the file holds only launcher keys", () => {
    establishTier({ dir, intended: MARATHON, stateDir, env: {} });
    writeFileSync(localSettingsFile(dir), `${JSON.stringify({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "500000" } }, null, 2)}\n`);
    const r = establishTier({ dir, intended: MARATHON, stateDir, env: {} });
    expect(r.action).toBe("refuse");
    expect(readLocalLayer(dir).window).toBe(500000);
  });

  it("refuses a windowed file with no record at all", () => {
    expect(foreign({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "150000" } }).action).toBe("refuse");
  });

  it("classifies the shapes directly, so the rule is readable on its own", () => {
    expect(launcherOwnedOnly('{"env":{"CLAUDE_CODE_AUTO_COMPACT_WINDOW":"300000"}}')).toBe(true);
    expect(launcherOwnedOnly("{}")).toBe(true);
    expect(launcherOwnedOnly("not json")).toBe(false);
    expect(launcherOwnedOnly("[]")).toBe(false);
    expect(launcherOwnedOnly('{"env":{"OTHER":"1"}}')).toBe(false);
  });

  // Re-stamping is not a way to adopt a file whose window somebody changed by hand.
  it("refuses to re-stamp a record whose window no longer matches the file", () => {
    establishTier({ dir, intended: MARATHON, stateDir, env: {} });
    writeFileSync(localSettingsFile(dir), `${JSON.stringify({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "999" } }, null, 2)}\n`);
    const r = restampTier({ dir, stateDir });
    expect(r.restamped).toBe(false);
    expect(r.reason).toMatch(/not ours to re-stamp/);
  });
});

describe("the writes themselves", () => {
  it("leaves no temp file behind", () => {
    establishTier({ dir, intended: MARATHON, stateDir, env: {} });
    const strays = [
      ...readdirSafe(join(dir, ".claude")),
      ...readdirSafe(stateDir),
    ].filter((n) => n.endsWith(".tmp"));
    expect(strays).toEqual([]);
  });

  it("writes a record the reader can actually match", () => {
    establishTier({ dir, intended: MARATHON, stateDir, env: {} });
    expect(readTierRecord({ dir, stateDir }).hash).toBe(hashOf(readFileSync(localSettingsFile(dir), "utf8")));
    expect(tierRecordFile({ dir, stateDir })).toMatch(/\.json$/);
  });
});

function readdirSafe(d) {
  try {
    return readdirSync(d);
  } catch {
    return [];
  }
}
