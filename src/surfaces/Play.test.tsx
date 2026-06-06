import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { SessionSummary } from "../types";

// Play (+ the embedded debrief) polls/reads on mount; mock invoke so it doesn't throw outside Tauri.
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
  compy_changes_active: 0,
});

const base = {
  active: true,
  sessionsSeenAt: "",
  priorities: null,
  recs: [],
  apply: vi.fn(),
  busyId: null,
  onExport: vi.fn(),
  changes: [],
  rollback: vi.fn(),
};

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

  it("a session row expands the full debrief IN PLACE (no route) — navigation never teleports", () => {
    render(<Play {...base} sessions={[session("doom.exe", 144)]} />);
    const row = screen.getByRole("button", { name: /doom\.exe/ });
    expect(row.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    // The full debrief verdict heading now renders inline.
    expect(screen.getByText(/Smooth session|smooth|Rough/i)).toBeInTheDocument();
  });
});
