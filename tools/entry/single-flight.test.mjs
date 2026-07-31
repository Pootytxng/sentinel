// Guard: two double-clicks are one launch.
//
// The token at %LOCALAPPDATA%\CompyEntry\launch.json is a SINGLETON. Two shortcut runs both passed
// preflight, both posted or renewed the same claim, and the second overwrote the first's nonce — so
// one session could take up the other's launch while the other waited out its whole budget for a
// record that had been replaced. Clicking twice is a normal thing a person does when the first click
// looks like it did nothing.
//
// A second run must write NOTHING and say one calm sentence. It is not an error that Kuya clicked
// twice, and treating it as one teaches him to ignore the launcher.
//
// The other half is that a lock must never outlive its process. A crashed run that leaves the
// shortcut permanently dead is worse than the race it was preventing — so staleness is proven from
// the pid and the clock, not hoped for.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_LOCK_MINUTES, acquire, lockFile, planAcquire, readLock, release } from "./single-flight.mjs";

const NOW = new Date("2026-07-31T12:00:00.000Z");
const ago = (min) => new Date(NOW.getTime() - min * 60_000).toISOString();
const held = (over = {}) => ({ pid: 4242, issue: 23, startedAt: ago(1), ...over });

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "compy-flight-"));
});
afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* a locked file on Windows must not fail the suite */
  }
});

describe("deciding whether this run may proceed", () => {
  const live = () => true;
  const dead = () => false;

  it("takes a lock nobody holds", () => {
    expect(planAcquire(null, { now: NOW }).action).toBe("take");
  });

  // The case the finding is about.
  it("waits when a live launcher already holds it, and names the task", () => {
    const p = planAcquire(held(), { now: NOW, alive: live });
    expect(p.action).toBe("wait");
    expect(p.reason).toBe("Compy is already starting #23.");
  });

  it("says the calm sentence even when the holder recorded no issue", () => {
    expect(planAcquire(held({ issue: null }), { now: NOW, alive: live }).reason).toBe("Compy is already starting.");
  });

  it("takes over from a launcher whose process is gone", () => {
    const p = planAcquire(held(), { now: NOW, alive: dead });
    expect(p.action).toBe("steal");
    expect(p.reason).toMatch(/pid 4242\) is gone/);
  });

  it("takes over a lock held longer than any launch could take", () => {
    const p = planAcquire(held({ startedAt: ago(MAX_LOCK_MINUTES + 5) }), { now: NOW, alive: live });
    expect(p.action).toBe("steal");
    expect(p.reason).toMatch(/longer than any launch takes/);
  });

  it("does not take over a live launcher just because it is a few minutes in", () => {
    expect(planAcquire(held({ startedAt: ago(MAX_LOCK_MINUTES - 1) }), { now: NOW, alive: live }).action).toBe("wait");
  });

  // A corrupt byte must not leave the shortcut dead for the rest of the day.
  it("takes over an unreadable lock rather than refusing forever", () => {
    const p = planAcquire({}, { now: NOW, alive: live });
    expect(p.action).toBe("steal");
    expect(p.reason).toMatch(/could not be read/);
  });

  it("treats a missing startedAt as infinitely old rather than as fresh", () => {
    expect(planAcquire(held({ startedAt: undefined }), { now: NOW, alive: live }).action).toBe("steal");
  });
});

describe("taking it for real", () => {
  it("the first run gets it and records who it is", () => {
    const r = acquire({ dir, issue: 23, pid: 111, now: NOW });
    expect(r.ok).toBe(true);
    expect(r.stole).toBe(false);
    expect(readLock({ dir })).toMatchObject({ pid: 111, issue: 23 });
  });

  // The whole point: the second run writes nothing at all.
  it("the second run is refused and changes nothing on disk", () => {
    acquire({ dir, issue: 23, pid: 111, now: NOW });
    const before = readFileSync(lockFile({ dir }), "utf8");

    const second = acquire({ dir, issue: 41, pid: 222, now: NOW, alive: () => true });
    expect(second.ok).toBe(false);
    expect(second.reason).toBe("Compy is already starting #23.");
    expect(readFileSync(lockFile({ dir }), "utf8")).toBe(before);
  });

  it("a later run takes over once the holder is gone", () => {
    acquire({ dir, issue: 23, pid: 111, now: NOW });
    const second = acquire({ dir, issue: 41, pid: 222, now: NOW, alive: () => false });
    expect(second.ok).toBe(true);
    expect(second.stole).toBe(true);
    expect(readLock({ dir }).pid).toBe(222);
  });

  it("releases only its own lock", () => {
    acquire({ dir, issue: 23, pid: 111, now: NOW });
    expect(release({ dir, pid: 222 })).toBe(false);
    expect(existsSync(lockFile({ dir }))).toBe(true);
    expect(release({ dir, pid: 111 })).toBe(true);
    expect(existsSync(lockFile({ dir }))).toBe(false);
  });

  it("releasing when nothing is held is not an error", () => {
    expect(release({ dir, pid: 111 })).toBe(false);
  });

  it("survives a lock file full of nonsense", () => {
    writeFileSync(lockFile({ dir }), "{{{ not json");
    const r = acquire({ dir, issue: 23, pid: 111, now: NOW, alive: () => true });
    expect(r.ok).toBe(true);
    expect(r.stole).toBe(true);
  });
});

// The shell reads an EXIT CODE, so the code is the contract — not the JSON beside it.
describe("the exit code compy-entry.ps1 acts on", () => {
  const CLI = join(process.cwd(), "tools", "entry", "single-flight.mjs");
  const run = (args, env) => {
    try {
      return { code: 0, json: JSON.parse(execFileSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { ...process.env, ...env } })) };
    } catch (e) {
      return { code: e.status, json: JSON.parse(String(e.stdout || "{}")) };
    }
  };

  it("says 0 to the first run and 2 to a second while the first is alive", () => {
    const env = { LOCALAPPDATA: dir };
    // The first "holder" is this test process, which is definitively alive.
    const first = run(["acquire", "--issue", "23", "--pid", String(process.pid)], env);
    expect(first.code).toBe(0);

    const second = run(["acquire", "--issue", "41", "--pid", "999999"], env);
    expect(second.code).toBe(2);
    expect(second.json.reason).toBe("Compy is already starting #23.");

    expect(run(["release", "--pid", String(process.pid)], env).code).toBe(0);
    expect(existsSync(join(dir, "CompyEntry", "launcher.lock"))).toBe(false);
  });
});
