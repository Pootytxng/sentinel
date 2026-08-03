// Update-check OFF SWITCH guards (2026-08-03).
//
// The privacy copy now promises that turning automatic checks off means Compy makes no network
// request on its own. That promise is only worth what these tests enforce: no launch check, no
// interval tick, and a manual "Check now" that still cannot overlap a running check.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

const updaterMocks = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: updaterMocks.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: updaterMocks.relaunch }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: updaterMocks.invoke }));

import { UpdatePill } from "./UpdatePill";
import {
  AUTO_UPDATE_CHECK_KEY,
  autoUpdateChecks,
  requestUpdateCheck,
  setAutoUpdateChecks,
} from "../data/update-prefs";

const RECHECK_MS = 4 * 60 * 60 * 1000;

beforeEach(() => {
  localStorage.clear();
  updaterMocks.check.mockResolvedValue(null);
  updaterMocks.invoke.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  updaterMocks.check.mockReset();
  updaterMocks.invoke.mockReset();
  localStorage.clear();
});

describe("automatic update checks preference", () => {
  it("defaults ON when unset, and only an explicit \"0\" disables it", () => {
    expect(autoUpdateChecks()).toBe(true);
    setAutoUpdateChecks(false);
    expect(localStorage.getItem(AUTO_UPDATE_CHECK_KEY)).toBe("0");
    expect(autoUpdateChecks()).toBe(false);
    setAutoUpdateChecks(true);
    expect(autoUpdateChecks()).toBe(true);
  });

  it("survives a storage read that throws (devtools-blocked storage must not disable updates)", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(autoUpdateChecks()).toBe(true);
    spy.mockRestore();
  });
});

describe("useUpdate honours the preference", () => {
  it("checks at launch and on the 4h tick while enabled", async () => {
    vi.useFakeTimers();
    render(<UpdatePill />);
    await act(async () => {});
    expect(updaterMocks.check).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(RECHECK_MS);
    });
    expect(updaterMocks.check).toHaveBeenCalledTimes(2);
  });

  it("makes NO request at launch and arms NO interval while disabled", async () => {
    localStorage.setItem(AUTO_UPDATE_CHECK_KEY, "0");
    vi.useFakeTimers();
    render(<UpdatePill />);
    await act(async () => {});
    expect(updaterMocks.check).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(RECHECK_MS * 3);
    });
    expect(updaterMocks.check).not.toHaveBeenCalled();
  });

  it("still runs a single check when the user asks, with automatic checks off", async () => {
    localStorage.setItem(AUTO_UPDATE_CHECK_KEY, "0");
    render(<UpdatePill />);
    await act(async () => {});
    expect(updaterMocks.check).not.toHaveBeenCalled();
    await act(async () => {
      requestUpdateCheck();
    });
    expect(updaterMocks.check).toHaveBeenCalledTimes(1);
  });

  it("manual checks share the mutex — a burst cannot overlap into concurrent requests", async () => {
    localStorage.setItem(AUTO_UPDATE_CHECK_KEY, "0");
    let release: (v: unknown) => void = () => {};
    updaterMocks.check.mockImplementation(() => new Promise((r) => (release = r)));
    render(<UpdatePill />);
    await act(async () => {});
    await act(async () => {
      requestUpdateCheck();
      requestUpdateCheck();
      requestUpdateCheck();
    });
    expect(updaterMocks.check).toHaveBeenCalledTimes(1);
    await act(async () => {
      release(null);
    });
  });

  it("arms polling without a relaunch when the preference is switched back on", async () => {
    localStorage.setItem(AUTO_UPDATE_CHECK_KEY, "0");
    render(<UpdatePill />);
    await act(async () => {});
    expect(updaterMocks.check).not.toHaveBeenCalled();
    await act(async () => {
      setAutoUpdateChecks(true);
    });
    expect(updaterMocks.check).toHaveBeenCalledTimes(1);
  });
});
