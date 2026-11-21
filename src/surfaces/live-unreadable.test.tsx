import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import type { SessionSummary } from "../types";
import i18n from "../i18n";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("./monitor/DeckScope", () => ({ DeckScope: () => <div data-testid="deck-scope" /> }));
vi.mock("./monitor/SessionStack", () => ({ SessionStack: () => <div data-testid="session-stack" /> }));

import { MonitorConsole } from "./MonitorConsole";
import Play from "./Play";
import { ConfirmProvider } from "../design/ConfirmDialog";

// M6-unread: while the capture helper cannot read the Windows process snapshot, the live readout
// says "Compy couldn't read this second." It is its own state: not 0 FPS, not the "capturing, launch
// a game" no-frames hint. When the helper reads again, the hint returns.

const cpuSnap = { usage_overall_pct: 34, frequency_mhz: 5100, ram_used_bytes: 1, ram_total_bytes: 2 };
const gpuSnap = [{ vendor: "amd", temperature_c: 62, utilization_gpu_pct: 97 }];

const unreadable = { active: true, status: "running", sample: null, unreadable_now: true, unreadable_ticks: 6 };
const noFrames = { active: true, status: "running", sample: null };
const live = {
  active: true,
  status: "running",
  sample: { fps: 142.3, low1_fps: 98.4, avg_frametime_ms: 7.0, recent_frametimes_ms: [7.1, 6.9] },
  unreadable_ticks: 6, // it missed some earlier, reads now: nothing to say this second
};

function mockPolls(fps: unknown) {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "get_cpu_sensors") return Promise.resolve(cpuSnap);
    if (cmd === "get_gpu_sensors") return Promise.resolve(gpuSnap);
    if (cmd === "get_fps_status") return Promise.resolve(fps);
    return Promise.resolve(null);
  });
}

const t = (key: string) => i18n.t(key) as string;

beforeEach(() => localStorage.setItem("compy_motion", "reduced"));
afterEach(async () => {
  cleanup();
  localStorage.clear();
  invokeMock.mockReset();
  await i18n.changeLanguage("en");
});

const sessions: SessionSummary[] = [];

describe.each(["en", "zh-CN"] as const)("the live readout when Compy couldn't read this second (%s)", (lang) => {
  it("Monitor: says so in the capture status and the scope, and does not say 0 fps or the no-frames hint", async () => {
    await i18n.changeLanguage(lang);
    mockPolls(unreadable);
    const { container } = render(<MonitorConsole active sessions={sessions} onFpsActive={vi.fn()} />);
    const line = t("monitor.unreadable.now");
    await waitFor(() => expect(container.querySelector(".mc-cap-status")?.textContent).toBe(line));
    expect(screen.getAllByText(line).length).toBeGreaterThanOrEqual(2); // status + the empty scope
    expect(container.textContent).not.toContain(t("monitor.monitorConsole.capturingStatus"));
    expect(container.textContent).not.toContain(t("monitor.monitorConsole.scopeCapturingHint"));
    expect(container.textContent).not.toMatch(/\b0\s*fps/i);
  });

  it("Monitor: plain no frames keeps its own words, and a live second shows the reading", async () => {
    await i18n.changeLanguage(lang);
    mockPolls(noFrames);
    const first = render(<MonitorConsole active sessions={sessions} onFpsActive={vi.fn()} />);
    await waitFor(() =>
      expect(first.container.querySelector(".mc-cap-status")?.textContent).toBe(t("monitor.monitorConsole.capturingStatus")),
    );
    expect(first.container.textContent).not.toContain(t("monitor.unreadable.now"));
    cleanup();
    mockPolls(live);
    const second = render(<MonitorConsole active sessions={sessions} onFpsActive={vi.fn()} />);
    await waitFor(() => expect(second.container.querySelector(".mc-cap-status")?.textContent).toMatch(/98/));
    expect(second.container.textContent).not.toContain(t("monitor.unreadable.now"));
  });

  it("Play: the live card says so in place of the capturing hint, and the figures stay '—', not 0", async () => {
    await i18n.changeLanguage(lang);
    mockPolls(unreadable);
    const { container } = render(
      <ConfirmProvider>
        <Play
          active
          view="live"
          sessions={sessions}
          sessionsSeenAt=""
          priorities={null}
          recs={[]}
          apply={vi.fn()}
          busyId={null}
          onExport={vi.fn()}
          changes={[]}
          rollback={vi.fn()}
        />
      </ConfirmProvider>,
    );
    await waitFor(() => expect(screen.getAllByText(t("monitor.unreadable.now")).length).toBe(1));
    expect(container.textContent).not.toContain(t("monitor.play.capturingHint"));
    const values = [...container.querySelectorAll(".play-metric-value")].slice(0, 2).map((n) => n.textContent);
    expect(values).toEqual(["—", "—"]);
  });

  it("Play: plain no frames still shows the capturing hint, not the unreadable line", async () => {
    await i18n.changeLanguage(lang);
    mockPolls(noFrames);
    const { container } = render(
      <ConfirmProvider>
        <Play
          active
          view="live"
          sessions={sessions}
          sessionsSeenAt=""
          priorities={null}
          recs={[]}
          apply={vi.fn()}
          busyId={null}
          onExport={vi.fn()}
          changes={[]}
          rollback={vi.fn()}
        />
      </ConfirmProvider>,
    );
    await waitFor(() => expect(container.textContent).toContain(t("monitor.play.capturingHint")));
    expect(container.textContent).not.toContain(t("monitor.unreadable.now"));
  });
});
