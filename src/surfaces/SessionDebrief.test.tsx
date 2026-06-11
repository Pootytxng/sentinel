import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { SessionSummary } from "../types";

// The debrief loads its comparison via invoke on mount; resolve null = no armed comparison.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

import { SessionDebrief } from "./SessionDebrief";
import { ConfirmProvider } from "../design/ConfirmDialog";

afterEach(cleanup);

const session: SessionSummary = {
  started_at: "2026-06-10T20:00:00Z",
  duration_secs: 5400,
  process_name: "eldenring.exe",
  samples: 900,
  avg_fps: 142.4,
  avg_frametime_ms: 7.0,
  low1_fps_est: 118.2,
  peak_gpu_temp_c: 71,
  peak_gpu_usage_pct: 98,
  peak_ram_used_bytes: null,
  ram_total_bytes: null,
  compy_changes_active: 2,
  stutter_insight: null,
};

const baseProps = {
  s: session,
  priorities: null,
  recs: [],
  apply: vi.fn(),
  busyId: null,
  onExport: vi.fn(),
  changes: [],
  rollback: vi.fn(),
};

describe("SessionDebrief (audit M1)", () => {
  it("renders the session receipt: game, tiles, and the 1%-low ESTIMATE label", async () => {
    render(
      <ConfirmProvider>
        <SessionDebrief {...baseProps} />
      </ConfirmProvider>,
    );
    // Header names the actual process — the receipt, not a vibe.
    expect(await screen.findByText(/eldenring\.exe/)).toBeInTheDocument();
    // Tiles: avg FPS + 1% low, with the honest-measurement "estimate" tag on the 1% low.
    expect(screen.getByText("142")).toBeInTheDocument();
    expect(screen.getByText("118")).toBeInTheDocument();
    expect(screen.getByText(/·\s*estimate/)).toBeInTheDocument();
    // GPU receipts render real values, not dashes, when present.
    expect(screen.getByText("98%")).toBeInTheDocument();
    expect(screen.getByText("71°C")).toBeInTheDocument();
  });

  it("missing sensors degrade to a dash — never a fabricated number", async () => {
    render(
      <ConfirmProvider>
        <SessionDebrief
          {...baseProps}
          s={{ ...session, peak_gpu_temp_c: null, peak_gpu_usage_pct: null }}
        />
      </ConfirmProvider>,
    );
    await screen.findByText(/eldenring\.exe/);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("the context strip counts Compy changes active during the session, and Share exports", async () => {
    const onExport = vi.fn();
    render(
      <ConfirmProvider>
        <SessionDebrief {...baseProps} onExport={onExport} />
      </ConfirmProvider>,
    );
    expect(
      await screen.findByText(/During this session: 2 Compy changes active/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(onExport).toHaveBeenCalled();
  });
});
