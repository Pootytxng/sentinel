// Guards for the editor handoff (#23): the launcher must hand off to a LIVE window and must prove
// the session arrived before it claims success and exits.
//
// Two defects are pinned here, both of them real rather than imagined:
//
//   - This machine carries four `~/.claude/ide/*.lock` files and three name windows that were closed
//     weeks ago. A readiness check that trusts the file instead of the pid fires the open-URI into
//     nothing and reports a launch that never happened.
//   - "A lineage file exists for this folder" is NOT proof of this launch; yesterday's run left one
//     there. The nonce written by the launcher and echoed by the hook is what makes the proof this
//     launch's, which is the same replay reasoning the in-session assert uses, applied from outside.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handoffState, parseLock, pickBridge, readLocks, waitForHandoff, waitUntil } from "./ide-bridge.mjs";
import { lineageFile } from "./session-assert.mjs";

const FOLDER = "C:\\Users\\Kuya\\code\\sentinel-marathon";
const OTHER = "C:\\Users\\Kuya\\code\\sentinel";

const lock = (folder, pid) =>
  JSON.stringify({ pid, workspaceFolders: [folder], ideName: "Visual Studio Code", transport: "ws", runningInWindows: true, authToken: "SECRET-abc123" });

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "compy-bridge-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("reading the extension's lock files", () => {
  it("never carries the auth token out of the file", () => {
    const parsed = parseLock(lock(FOLDER, 4242), { file: join(dir, "12561.lock") });
    expect(JSON.stringify(parsed)).not.toMatch(/SECRET-abc123|authToken/);
    expect(parsed).toMatchObject({ pid: 4242, port: 12561, ideName: "Visual Studio Code" });
  });

  it("treats an unreadable or shapeless lock as no evidence at all", () => {
    expect(parseLock("{ not json")).toBeNull();
    expect(parseLock("null")).toBeNull();
    expect(parseLock(JSON.stringify({ pid: "nonsense" })).pid).toBeNull();
  });

  it("reads every lock in the folder and ignores anything else in it", () => {
    writeFileSync(join(dir, "12561.lock"), lock(FOLDER, 1));
    writeFileSync(join(dir, "24362.lock"), lock(OTHER, 2));
    writeFileSync(join(dir, "notes.txt"), "not a lock");
    expect(readLocks({ dir })).toHaveLength(2);
  });

  it("returns nothing rather than throwing when the extension has never run", () => {
    expect(readLocks({ dir: join(dir, "absent") })).toEqual([]);
  });
});

describe("choosing the bridge", () => {
  const alive = (pids) => (pid) => pids.includes(pid);
  // These cases are about FOLDER and PROCESS matching. The third readiness clause -- the bridge port
  // actually answering -- is held open here so each test still measures the one thing it is named
  // for; bridge-readiness.test.mjs drives that clause on its own, including the case where a live
  // window's port is closed.
  const listening = () => true;

  it("picks the window that is open on this folder", () => {
    const locks = [parseLock(lock(OTHER, 1), { file: "111.lock" }), parseLock(lock(FOLDER, 2), { file: "222.lock" })];
    const r = pickBridge(locks, { folder: FOLDER, alive: alive([1, 2]), listening });
    expect(r.ok).toBe(true);
    expect(r.lock.pid).toBe(2);
  });

  // The live machine case: three of four locks name windows closed weeks ago.
  it("refuses a lock whose window is gone — a stale lock is not readiness", () => {
    const locks = [parseLock(lock(FOLDER, 34864))];
    const r = pickBridge(locks, { folder: FOLDER, alive: alive([]), listening });
    expect(r.ok).toBe(false);
    expect(r.stale).toHaveLength(1);
    expect(r.reason).toMatch(/no window behind it is running/i);
  });

  it("does not accept a live window that is open on a different folder", () => {
    const locks = [parseLock(lock(OTHER, 7))];
    const r = pickBridge(locks, { folder: FOLDER, alive: alive([7]), listening });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no editor window is open on this folder/i);
  });

  it("matches the folder however the editor spelled it", () => {
    const locks = [parseLock(lock("c:/users/kuya/code/sentinel-marathon/", 9), { file: "999.lock" })];
    expect(pickBridge(locks, { folder: FOLDER, alive: alive([9]), listening }).ok).toBe(true);
  });

  it("leaves stale locks alone — they belong to the extension, not to us", () => {
    writeFileSync(join(dir, "12561.lock"), lock(FOLDER, 34864));
    pickBridge(readLocks({ dir }), { folder: FOLDER, alive: alive([]), listening });
    expect(readLocks({ dir })).toHaveLength(1);
  });
});

describe("waiting", () => {
  const fake = () => {
    let t = 0;
    return { clock: () => t, sleep: async (ms) => { t += ms; } };
  };

  it("returns as soon as the check passes", async () => {
    const { clock, sleep } = fake();
    let calls = 0;
    const r = await waitUntil(async () => ({ ok: ++calls >= 3 }), { timeoutMs: 10_000, intervalMs: 500, clock, sleep });
    expect(r.ok).toBe(true);
    expect(r.waitedMs).toBe(1000);
  });

  it("gives up on a bounded budget instead of hanging", async () => {
    const { clock, sleep } = fake();
    const r = await waitUntil(async () => ({ ok: false, reason: "not yet" }), { timeoutMs: 2000, intervalMs: 500, clock, sleep });
    expect(r).toMatchObject({ ok: false, timedOut: true, waitedMs: 2000 });
    expect(r.state.reason).toBe("not yet");
  });

  it("stops immediately on something waiting cannot fix", async () => {
    const { clock, sleep } = fake();
    const r = await waitUntil(async () => ({ ok: false, stop: true }), { timeoutMs: 120_000, intervalMs: 500, clock, sleep });
    expect(r).toMatchObject({ ok: false, stopped: true, waitedMs: 0 });
    expect(r.timedOut).toBeUndefined();
  });
});

describe("proving the handoff", () => {
  const NONCE = "11111111-2222-3333-4444-555555555555";
  const token = (over = {}) => ({ issue: 23, folder: FOLDER, branch: "tooling/start-work-marathon", window: 300000, repo: "Pootytxng/sentinel", nonce: NONCE, issuedAt: "2026-07-31T10:00:00.000Z", expiresAt: "2026-07-31T10:30:00.000Z", claimedAt: null, consumedAt: null, ...over });

  const write = (t, lineage) => {
    if (t) writeFileSync(join(dir, "launch.json"), JSON.stringify(t));
    if (lineage) {
      mkdirSync(join(dir, "sessions"), { recursive: true });
      writeFileSync(lineageFile({ root: lineage.folder, dir }), JSON.stringify(lineage));
    }
  };
  const lineage = (over = {}) => ({ issue: 23, folder: FOLDER, branch: "tooling/start-work-marathon", window: 300000, nonce: NONCE, lastSeenAt: "2026-07-31T10:01:00.000Z", ...over });

  it("is not satisfied until a session has taken the launch up", () => {
    write(token(), null);
    expect(handoffState({ folder: FOLDER, dir })).toMatchObject({ ok: false, reason: "no session has taken the launch up yet" });
  });

  it("passes when the folder's session record carries THIS launch", () => {
    write(token({ claimedAt: "2026-07-31T10:01:00.000Z" }), lineage());
    expect(handoffState({ folder: FOLDER, dir })).toMatchObject({ ok: true, issue: 23 });
  });

  // Replay: the folder already had a record from an earlier launch. Its nonce is not this one's.
  it("refuses an older session record left in the same folder", () => {
    write(token({ claimedAt: "2026-07-31T10:01:00.000Z" }), lineage({ nonce: "99999999-0000-0000-0000-000000000000" }));
    expect(handoffState({ folder: FOLDER, dir })).toMatchObject({ ok: false });
  });

  it("refuses a record for a different issue even under the same nonce", () => {
    write(token({ claimedAt: "2026-07-31T10:01:00.000Z" }), lineage({ issue: 13 }));
    expect(handoffState({ folder: FOLDER, dir }).ok).toBe(false);
  });

  it("does not accept a session that started in the wrong folder", () => {
    write(token({ claimedAt: "2026-07-31T10:01:00.000Z" }), lineage({ folder: OTHER }));
    expect(handoffState({ folder: FOLDER, dir }).ok).toBe(false);
  });

  it("stops rather than waiting out the budget when the token is gone", async () => {
    let slept = 0;
    const r = await waitForHandoff({ folder: FOLDER, dir, timeoutMs: 120_000, clock: () => 0, sleep: async () => { slept += 1; } });
    expect(r).toMatchObject({ ok: false, stopped: true });
    expect(slept).toBe(0);
    expect(r.state.reason).toMatch(/launch token is gone/i);
  });
});
