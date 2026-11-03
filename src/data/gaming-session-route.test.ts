import { describe, it, expect, vi, afterEach } from "vitest";

const invokeMock = vi.fn<(cmd: string) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string) => invokeMock(cmd) }));

import { readSessionSlot, routeSession } from "./gaming-session-route";

afterEach(() => invokeMock.mockReset());

describe("routeSession — only the live in-run session resumes", () => {
  it("active + live this run (a tab-switch remount) → resume", () => {
    expect(routeSession("active", true)).toBe("resume");
  });

  it("active from a prior run that died — reboot/crash → recover", () => {
    // The trap we're closing: never show this as 'Gaming Mode on'.
    expect(routeSession("active", false)).toBe("recover");
  });

  it("interrupted-restore statuses → recover, regardless of the live flag", () => {
    for (const s of ["ending", "restore-pending", "restore-failed"]) {
      expect(routeSession(s, false)).toBe("recover");
      expect(routeSession(s, true)).toBe("recover");
    }
  });
});

// The one re-read the pane's mount, a failed start and App's banner share (codebase review
// 2026-11-03) — so a contract a failed start leaves is shown the same way everywhere.
describe("readSessionSlot", () => {
  const file = (status: string) => ({ session_id: "gm-1", status, changes: [] });

  it("an empty or unreadable slot is none — never a guessed contract", async () => {
    invokeMock.mockResolvedValue(null);
    expect(await readSessionSlot()).toEqual({ route: "none" });
    invokeMock.mockRejectedValue(new Error("gated"));
    expect(await readSessionSlot()).toEqual({ route: "none" });
  });

  it("a restore-failed contract routes to recover without asking about liveness", async () => {
    invokeMock.mockImplementation((cmd) =>
      cmd === "get_gaming_session_state" ? Promise.resolve(file("restore-failed")) : Promise.reject(new Error(cmd)),
    );
    const slot = await readSessionSlot();
    expect(slot.route).toBe("recover");
    expect(invokeMock.mock.calls.map(([c]) => c)).toEqual(["get_gaming_session_state"]);
  });

  it("an active session resumes only when this run owns it; an unreadable owner check recovers", async () => {
    let live: () => Promise<unknown> = () => Promise.resolve(true);
    invokeMock.mockImplementation((cmd) =>
      cmd === "get_gaming_session_state" ? Promise.resolve(file("active")) : live(),
    );
    expect((await readSessionSlot()).route).toBe("resume");
    live = () => Promise.resolve(false);
    expect((await readSessionSlot()).route).toBe("recover");
    live = () => Promise.reject(new Error("ipc"));
    expect((await readSessionSlot()).route).toBe("recover");
  });
});
