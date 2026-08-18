import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { SessionSummary } from "../types";

// Monitor wraps Play, which polls/reads invoke on mount — mock it so it doesn't throw outside Tauri.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

import Monitor from "./Monitor";
import { ConfirmProvider } from "../design/ConfirmDialog";

afterEach(() => {
  cleanup();
  // Mode isolation: never leak the chosen Basic/Advanced mode between tests.
  delete document.documentElement.dataset.viewMode;
  localStorage.clear();
});

const session = (game: string, avg: number): SessionSummary => ({
  started_at: "2026-06-06T10:00:00Z",
  duration_secs: 600,
  process_name: game,
  samples: 600,
  avg_fps: avg,
  avg_frametime_ms: 1000 / avg,
  low1_fps_est: avg * 0.7,
  peak_gpu_temp_c: 70,
  peak_gpu_usage_pct: 98,
  peak_ram_used_bytes: null,
  ram_total_bytes: null,
  compy_changes_active: 0,
});

const base = {
  active: true,
  sessions: [session("halo.exe", 120)],
  sessionsSeenAt: "",
  priorities: null,
  recs: [],
  apply: vi.fn(),
  busyId: null,
  onExport: vi.fn(),
  changes: [],
  rollback: vi.fn(),
};

const renderMonitor = () =>
  render(
    <ConfirmProvider>
      <Monitor {...base} />
    </ConfirmProvider>,
  );

describe("Monitor — segmented shell in Advanced mode (restructure tab #2)", () => {
  const advanced = () => localStorage.setItem("compy_view_mode", "advanced");

  it("renders Live + Sessions segments and DEFAULTS to Live (the primary live meters)", () => {
    advanced();
    renderMonitor();
    expect(screen.getByRole("tab", { name: "Live" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Sessions" })).toBeInTheDocument();
    // Default = Live (owner 2026-06-26): the live monitor cards are on screen; the sessions list is not.
    expect(screen.getByText("Live monitor")).toBeInTheDocument();
    expect(screen.getByText("In-game overlay")).toBeInTheDocument();
    expect(screen.queryByText("Recent sessions")).toBeNull();
  });

  it("clicking 'Sessions' swaps to the last-game debrief (and drops the live cards)", () => {
    advanced();
    renderMonitor();
    fireEvent.click(screen.getByRole("tab", { name: "Sessions" }));
    expect(screen.getByText("avg FPS")).toBeInTheDocument();
    expect(screen.getByText("Recent sessions")).toBeInTheDocument();
    expect(screen.queryByText("Live monitor")).toBeNull();
  });
});

// ── Basic/Advanced split — the two-mode contract (Basic = the glanceable answer face) ──
describe("Monitor — Basic/Advanced split", () => {
  it("defaults to BASIC: exactly 4 tiles (FPS · GPU temp · CPU · RAM), no panels, no presets, no Live/Sessions tabs", () => {
    const { container } = renderMonitor();
    // The mode switch is on; the Live/Sessions segments are collapsed into the Basic face.
    expect(screen.getByRole("tab", { name: "Basic" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Advanced" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Live" })).toBeNull();
    // Exactly 4 glanceable tiles, correctly labeled.
    expect(container.querySelectorAll(".mb-tile").length).toBe(4);
    expect(screen.getByText("FPS")).toBeInTheDocument();
    expect(screen.getByText("GPU temp")).toBeInTheDocument();
    expect(screen.getByText("CPU")).toBeInTheDocument();
    expect(screen.getByText("RAM")).toBeInTheDocument();
    // Today's panels + advisory presets live in Advanced, not here.
    expect(screen.queryByText("Live monitor")).toBeNull();
    expect(screen.queryByText("In-game overlay")).toBeNull();
    expect(screen.queryByText("Tuning presets")).toBeNull();
    // The honesty line survives the slim-down AND the 2026-08-18 plain-English pass: same claim
    // (nothing added to the game, nothing installed deep in Windows), said without the jargon.
    expect(screen.getByText(/nothing added to it, and no driver installed deep in Windows/)).toBeInTheDocument();
  });

  it("switching to Advanced restores today's panels exactly (live cards + presets + segments)", () => {
    renderMonitor();
    fireEvent.click(screen.getByRole("tab", { name: "Advanced" }));
    expect(screen.getByRole("tab", { name: "Live" })).toBeInTheDocument();
    expect(screen.getByText("Live monitor")).toBeInTheDocument();
    expect(screen.getByText("In-game overlay")).toBeInTheDocument();
    expect(screen.getByText("Tuning presets")).toBeInTheDocument();
  });

  it("the last-session line is a door: it routes to Advanced → Sessions (never a dead end)", () => {
    renderMonitor();
    fireEvent.click(screen.getByRole("button", { name: /Last session/ }));
    expect(screen.getByText("Recent sessions")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Advanced" }).getAttribute("aria-selected")).toBe("true");
  });

  it("the chosen mode persists (advanced sticks across a re-render)", () => {
    const first = renderMonitor();
    fireEvent.click(screen.getByRole("tab", { name: "Advanced" }));
    first.unmount();
    renderMonitor();
    expect(screen.getByText("Live monitor")).toBeInTheDocument(); // still Advanced
  });
});
