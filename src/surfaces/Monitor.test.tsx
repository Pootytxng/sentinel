import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { SessionSummary } from "../types";

// Monitor wraps Play, which polls/reads invoke on mount — mock it so it doesn't throw outside Tauri.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

import Monitor from "./Monitor";
import { ConfirmProvider } from "../design/ConfirmDialog";

afterEach(cleanup);

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

describe("Monitor — segmented shell (restructure tab #2)", () => {
  it("renders Live + Sessions segments and DEFAULTS to Live (the primary live meters)", () => {
    renderMonitor();
    expect(screen.getByRole("tab", { name: "Live" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Sessions" })).toBeInTheDocument();
    // Default = Live (owner 2026-06-26): the live monitor cards are on screen; the sessions list is not.
    expect(screen.getByText("Live monitor")).toBeInTheDocument();
    expect(screen.getByText("In-game overlay")).toBeInTheDocument();
    expect(screen.queryByText("Recent sessions")).toBeNull();
  });

  it("clicking 'Sessions' swaps to the last-game debrief (and drops the live cards)", () => {
    renderMonitor();
    fireEvent.click(screen.getByRole("tab", { name: "Sessions" }));
    expect(screen.getByText("avg FPS")).toBeInTheDocument();
    expect(screen.getByText("Recent sessions")).toBeInTheDocument();
    expect(screen.queryByText("Live monitor")).toBeNull();
  });
});
