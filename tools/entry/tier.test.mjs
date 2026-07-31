// Guards 7 and 8 — the context tier is ESTABLISHED, not merely observed.
//
// The defect this pins (#23): `settings.window` could only compare an intended window with an
// effective one and refuse on disagreement. Nothing could make them agree. A marathon-tier issue in
// a freshly created worktree — whose tracked settings say 150000, correctly, for every standard
// train — therefore refused forever, and the owner was left setting an environment variable by hand.
// That is the chore this program exists to delete.
//
// Two-sided, like the comparison it completes: a standard train must not end up at 300000 either.
// And establishment is never a licence to overwrite: a local settings file the launcher cannot prove
// it wrote is somebody else's, and the answer to somebody else's file is REFUSE, not a rewrite.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { establishTier, planTier, readTierRecord } from "./tier.mjs";
import { resolveWindow } from "./settings-resolve.mjs";

const MARATHON = { window: 300000, marathon: true, reason: "issue #23 is scoped to the 300000 marathon tier" };
const STANDARD = { window: 150000, marathon: false, reason: "default policy window for a standard-tier train (#13)" };

let root;
let stateDir;
let home;

const localPath = (dir) => join(dir, ".claude", "settings.local.json");
const readLocal = (dir) => JSON.parse(readFileSync(localPath(dir), "utf8"));

/** A worktree whose TRACKED settings configure the standard window — i.e. every branch we have. */
function mkFolder(name, { project = { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "150000" } }, local = null } = {}) {
  const dir = join(root, name);
  mkdirSync(join(dir, ".claude"), { recursive: true });
  if (project) writeFileSync(join(dir, ".claude", "settings.json"), JSON.stringify(project, null, 2));
  if (local !== null) writeFileSync(localPath(dir), typeof local === "string" ? local : JSON.stringify(local, null, 2));
  return dir;
}

const effective = (dir) => resolveWindow({ dir, home, env: {} });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "compy-tier-"));
  stateDir = join(root, "_state");
  home = join(root, "_home");
  mkdirSync(join(home, ".claude"), { recursive: true });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("guard 8 — a marathon task must not be left at 150k", () => {
  it("establishes 300000 in the launcher-owned local layer", () => {
    const dir = mkFolder("marathon");
    expect(effective(dir).window).toBe(150000);

    const result = establishTier({ dir, intended: MARATHON, stateDir, home });

    expect(result.action).toBe("write");
    expect(result.window).toBe(300000);
    expect(readLocal(dir).env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe("300000");

    const after = effective(dir);
    expect(after.window).toBe(300000);
    expect(after.configured).toBe(true);
    expect(after.layer).toBe("local");
  });

  it("records what it wrote, so the next run can prove the file is its own", () => {
    const dir = mkFolder("marathon");
    establishTier({ dir, intended: MARATHON, stateDir, home });

    const record = readTierRecord({ dir, stateDir });
    expect(record).not.toBeNull();
    expect(record.window).toBe(300000);
    expect(record.hash).toEqual(expect.any(String));

    // Second run is a no-op: same folder, same tier, file already ours and already right.
    const again = establishTier({ dir, intended: MARATHON, stateDir, home });
    expect(again.action).toBe("keep");
    expect(again.wrote).toBe(false);
  });
});

describe("guard 7 — a standard task must not be left at 300k", () => {
  it("rewrites a launcher-owned 300000 back down to the standard window", () => {
    const dir = mkFolder("was-marathon");
    establishTier({ dir, intended: MARATHON, stateDir, home });
    expect(effective(dir).window).toBe(300000);

    const result = establishTier({ dir, intended: STANDARD, stateDir, home });

    expect(result.action).toBe("write");
    expect(effective(dir).window).toBe(150000);
    expect(readLocal(dir).env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe("150000");
  });

  it("writes nothing when the tracked settings already configure the standard window", () => {
    const dir = mkFolder("standard");
    const result = establishTier({ dir, intended: STANDARD, stateDir, home });

    expect(result.action).toBe("keep");
    expect(result.wrote).toBe(false);
    expect(existsSync(localPath(dir))).toBe(false);
  });
});

describe("a local settings file the launcher cannot prove it wrote is not its to change", () => {
  it("refuses a foreign file that disagrees, and leaves it byte-for-byte", () => {
    const foreign = { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "200000" }, permissions: { allow: ["Bash(ls:*)"] } };
    const dir = mkFolder("foreign", { local: foreign });
    const before = readFileSync(localPath(dir), "utf8");

    const result = establishTier({ dir, intended: MARATHON, stateDir, home });

    expect(result.action).toBe("refuse");
    expect(result.reason).toMatch(/not written by the launcher/i);
    expect(readFileSync(localPath(dir), "utf8")).toBe(before);
  });

  it("leaves a foreign file alone when it already agrees", () => {
    const dir = mkFolder("foreign-ok", { local: { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "300000" } } });
    const before = readFileSync(localPath(dir), "utf8");

    const result = establishTier({ dir, intended: MARATHON, stateDir, home });

    expect(result.action).toBe("keep");
    expect(result.wrote).toBe(false);
    expect(readFileSync(localPath(dir), "utf8")).toBe(before);
  });

  it("refuses an unparseable local file rather than replacing it", () => {
    const dir = mkFolder("broken", { local: "{ this is not json" });

    const result = establishTier({ dir, intended: MARATHON, stateDir, home });

    expect(result.action).toBe("refuse");
    expect(result.reason).toMatch(/could not be read/i);
    expect(readFileSync(localPath(dir), "utf8")).toBe("{ this is not json");
  });

  it("refuses a file that was ours until somebody edited it", () => {
    const dir = mkFolder("edited");
    establishTier({ dir, intended: MARATHON, stateDir, home });
    writeFileSync(localPath(dir), JSON.stringify({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "500000" } }, null, 2));

    const result = establishTier({ dir, intended: MARATHON, stateDir, home });

    expect(result.action).toBe("refuse");
    expect(effective(dir).window).toBe(500000);
  });
});

describe("planTier is pure and states its own evidence", () => {
  it("does not decide from a hash it was not given", () => {
    const plan = planTier({
      intended: MARATHON,
      projectWindow: 150000,
      local: { present: true, text: '{"env":{"CLAUDE_CODE_AUTO_COMPACT_WINDOW":"150000"}}', window: 150000, ok: true },
      record: null,
    });
    expect(plan.action).toBe("refuse");
    expect(plan.reason).toMatch(/not written by the launcher/i);
  });

  it("names the window it would write", () => {
    const plan = planTier({ intended: MARATHON, projectWindow: 150000, local: { present: false }, record: null });
    expect(plan).toMatchObject({ action: "write", window: 300000 });
  });
});
