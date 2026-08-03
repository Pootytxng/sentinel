// Guard: a live process is not a live bridge.
//
// `pickBridge` treated "a lock names this folder" + "its recorded pid is alive" as ready, and the
// launcher then fired the handoff at it. Neither clause proves anything is listening. VS Code stays
// up while its extension host dies; a recycled pid makes a weeks-old lock look current — four locks
// sit in ~/.claude/ide on this machine and three name windows closed weeks ago. So the launcher
// could report "Claude started there" into a socket nobody was on.
//
// The lock's FILENAME is the port. Readiness needs all three: the exact folder, a live process, and
// a port answering now.

import { describe, expect, it } from "vitest";
import { isListening, pickBridge } from "./ide-bridge.mjs";

const FOLDER = "C:\\Users\\Kuya\\code\\sentinel-marathon";
const OTHER = "C:\\Users\\Kuya\\code\\sentinel-feedback";
const lock = (port, folders, pid = 100) => ({ file: `${port}.lock`, port, pid, folders, ideName: "VS Code", transport: "ws" });

const pick = (locks, { alivePids = [100], openPorts = [] } = {}) =>
  pickBridge(locks, {
    folder: FOLDER,
    alive: (pid) => alivePids.includes(pid),
    listening: (port) => openPorts.includes(port),
  });

describe("readiness needs all three clauses", () => {
  it("accepts the folder's window when its port answers", () => {
    const r = pick([lock(24362, [FOLDER])], { openPorts: [24362] });
    expect(r.ok).toBe(true);
    expect(r.lock.port).toBe(24362);
  });

  // The defect, exactly: folder matches, pid is alive, and the socket is gone.
  it("refuses a live window whose bridge port is closed", () => {
    const r = pick([lock(24362, [FOLDER])], { openPorts: [] });
    expect(r.ok).toBe(false);
    expect(r.lock).toBe(null);
    expect(r.deaf).toHaveLength(1);
    expect(r.reason).toMatch(/not accepting connections/i);
  });

  it("refuses a lock whose process is gone, and still calls that stale rather than deaf", () => {
    const r = pick([lock(24362, [FOLDER], 999)], { alivePids: [100], openPorts: [24362] });
    expect(r.ok).toBe(false);
    expect(r.stale).toHaveLength(1);
    expect(r.deaf).toHaveLength(0);
    expect(r.reason).toMatch(/no window behind/i);
  });

  it("ignores a listening window that is open on a different folder", () => {
    expect(pick([lock(24362, [OTHER])], { openPorts: [24362] }).ok).toBe(false);
  });

  // The real shape on this machine: several locks, one of them the answer.
  it("picks the one live listening window out of a folder full of dead locks", () => {
    const r = pick(
      [lock(12561, [FOLDER], 998), lock(35257, [FOLDER], 997), lock(24362, [FOLDER], 100), lock(52107, [OTHER], 100)],
      { alivePids: [100], openPorts: [24362] },
    );
    expect(r.ok).toBe(true);
    expect(r.lock.port).toBe(24362);
    expect(r.stale).toHaveLength(2);
  });

  it("refuses a lock with no port in its name at all", () => {
    const bad = { ...lock(24362, [FOLDER]), port: null };
    expect(pick([bad], { openPorts: [24362] }).ok).toBe(false);
  });
});

describe("the probe itself", () => {
  it("says no to a port nothing is on", () => {
    // 1 is privileged and unbound; a refused connection is the answer, not an error.
    expect(isListening(1, { timeoutMs: 200 })).toBe(false);
  });

  it("says no to a nonsense port rather than throwing", () => {
    expect(isListening(0)).toBe(false);
    expect(isListening(-1)).toBe(false);
    expect(isListening(null)).toBe(false);
  });
});
