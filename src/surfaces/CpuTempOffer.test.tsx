// GUARD — the CPU-temp row must never be a dead end again (Q9c, bug→guard).
//
// The defect this pins: with no sensor app publishing, the row rendered ONE sentence telling the
// user to go run HWiNFO or LibreHardwareMonitor, and stopped. It named a problem and handed back no
// way to fix it — the exact shape the name-it-AND-fix-it-inline law forbids, and invisible to tsc,
// to vitest and to a screenshot that "looks fine".
//
// So the law here is behavioural, not cosmetic: in EVERY observable state, the offer renders an
// action the user can take — a button that starts what they already have, a download, or the exact
// switch to flip — and it never tells someone to install what is already running.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";

const backend = vi.hoisted(() => ({
  report: null as unknown,
  launched: [] as string[],
  launchFails: false,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "get_sensor_sources") return Promise.resolve(backend.report);
    if (cmd === "launch_sensor_app") {
      backend.launched.push(String(args?.app));
      return backend.launchFails ? Promise.reject("nope") : Promise.resolve(null);
    }
    return Promise.resolve(null);
  }),
}));

const opened = vi.hoisted(() => ({ urls: [] as string[] }));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn((url: string) => {
    opened.urls.push(url);
    return Promise.resolve();
  }),
}));

import { CpuTempOffer, offerFor, type SensorAppId, type SensorSourceReport } from "./CpuTempOffer";

afterEach(() => {
  cleanup();
  backend.report = null;
  backend.launched = [];
  backend.launchFails = false;
  opened.urls = [];
});

function app(
  id: SensorAppId,
  over: Partial<{ running: boolean; publishing: boolean; launchable: boolean }> = {},
) {
  const running = over.running ?? false;
  const publishing = over.publishing ?? false;
  const launchable = over.launchable ?? false;
  return { id, running, publishing, launchable, installed: running || publishing || launchable };
}

function report(
  hwinfo: Partial<{ running: boolean; publishing: boolean; launchable: boolean }>,
  lhm: Partial<{ running: boolean; publishing: boolean; launchable: boolean }> = {},
  scanned = 120,
): SensorSourceReport {
  return { apps: [app("hwinfo", hwinfo), app("lhm", lhm)], scanned };
}

describe("offerFor — one next step, and never the wrong one", () => {
  it("offers the downloads when nothing is present", () => {
    expect(offerFor(report({}, {})).kind).toBe("install");
  });

  it("offers the downloads when the backend never answered", () => {
    // No report is not evidence of "nothing installed", but the downloads are still the only honest
    // move — and the copy for this branch does not claim the user lacks a monitor.
    expect(offerFor(null).kind).toBe("install");
  });

  it("names the Shared Memory switch when HWiNFO is already running", () => {
    // The bug shape: telling someone to run HWiNFO while HWiNFO is running.
    expect(offerFor(report({ running: true, launchable: true })).kind).toBe("sharedMemoryOff");
  });

  it("offers to start an app that is installed and closed", () => {
    expect(offerFor(report({ launchable: true }))).toEqual({ kind: "start", app: "hwinfo" });
    expect(offerFor(report({}, { launchable: true }))).toEqual({ kind: "start", app: "lhm" });
  });

  it("tells an LHM user it needs administrator rights rather than a download", () => {
    expect(offerFor(report({}, { running: true, launchable: true }))).toEqual({
      kind: "notPublishing",
      app: "lhm",
    });
  });

  it("says so when a monitor publishes sensors but no CPU temperature", () => {
    // Reached only because the caller mounts this when the temperature is missing.
    expect(offerFor(report({ running: true, publishing: true }))).toEqual({
      kind: "publishingWithoutCpuTemp",
      app: "hwinfo",
    });
  });
});

describe("CpuTempOffer — every state ends in something the user can do", () => {
  it("offers both downloads when no monitor is installed", async () => {
    backend.report = report({}, {});
    render(<CpuTempOffer />);
    const hwinfo = await screen.findByRole("button", { name: "HWiNFO" });
    fireEvent.click(hwinfo);
    fireEvent.click(screen.getByRole("button", { name: "LibreHardwareMonitor" }));
    await waitFor(() => expect(opened.urls).toHaveLength(2));
    expect(opened.urls[0]).toContain("hwinfo.com");
    expect(opened.urls[1]).toContain("LibreHardwareMonitor");
  });

  it("starts the installed app instead of sending the user to a download", async () => {
    backend.report = report({ launchable: true });
    render(<CpuTempOffer />);
    const start = await screen.findByRole("button", { name: /Start HWiNFO/ });
    // The download buttons must NOT be the offer here — that was the dead end.
    expect(screen.queryByRole("button", { name: "LibreHardwareMonitor" })).toBeNull();
    fireEvent.click(start);
    await waitFor(() => expect(backend.launched).toEqual(["hwinfo"]));
  });

  it("says what to do when the launch fails, instead of going quiet", async () => {
    backend.report = report({ launchable: true });
    backend.launchFails = true;
    render(<CpuTempOffer />);
    fireEvent.click(await screen.findByRole("button", { name: /Start HWiNFO/ }));
    await waitFor(() => expect(screen.getByText(/Start menu/)).toBeTruthy());
  });

  it("spells out the Shared Memory Support switch when HWiNFO is up", async () => {
    backend.report = report({ running: true, launchable: true });
    render(<CpuTempOffer />);
    // The fix has to be the actual steps, not a restatement of the problem.
    expect(await screen.findByText(/Shared Memory Support/)).toBeTruthy();
    expect(screen.getByText(/Settings/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Start HWiNFO/ })).toBeNull();
  });

  it("always leaves a way to re-check without restarting Compy", async () => {
    backend.report = report({}, {});
    render(<CpuTempOffer />);
    fireEvent.click(await screen.findByRole("button", { name: "Check again" }));
    // Two loads: the mount and the click.
    const { invoke } = await import("@tauri-apps/api/core");
    await waitFor(() =>
      expect(
        (invoke as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(
          (c) => c[0] === "get_sensor_sources",
        ).length,
      ).toBeGreaterThanOrEqual(2),
    );
  });
});
