import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { SessionSummary } from "../types";

// Play polls sensors + reads overlay state on mount; mock invoke so it doesn't throw outside Tauri.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

import Play from "./Play";

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
});

const base = { active: true, sessionsSeenAt: "", onOpenSessions: vi.fn(), onOpenMonitoring: vi.fn() };

describe("Play", () => {
  it("renders the live monitor + overlay cards and condensed session rows", () => {
    render(<Play {...base} sessions={[session("game.exe", 120)]} />);
    expect(screen.getByText("Live monitor")).toBeInTheDocument();
    expect(screen.getByText("In-game overlay")).toBeInTheDocument();
    expect(screen.getByText("game.exe")).toBeInTheDocument();
  });

  it("honest empty state when no sessions", () => {
    render(<Play {...base} sessions={[]} />);
    expect(screen.getByText(/Play a session to see this/)).toBeInTheDocument();
  });

  it("a session row opens the full existing debrief (navigates)", () => {
    const onOpenSessions = vi.fn();
    render(<Play {...base} sessions={[session("doom.exe", 144)]} onOpenSessions={onOpenSessions} />);
    fireEvent.click(screen.getByText("doom.exe"));
    expect(onOpenSessions).toHaveBeenCalled();
  });
});
