import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { SessionSummary } from "../types";

// Play (+ the embedded debrief) polls/reads on mount; mock invoke so it doesn't throw outside Tauri.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

import Play, { fmtDur, fmtDurCoarse } from "./Play";
import { ConfirmProvider } from "../design/ConfirmDialog";

afterEach(cleanup);

// Play embeds SessionDebrief, which uses useConfirm → render under the provider.
const renderPlay = (extra: Partial<Parameters<typeof Play>[0]>) =>
  render(
    <ConfirmProvider>
      <Play {...base} {...extra} />
    </ConfirmProvider>,
  );

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
  sessions: [] as SessionSummary[],
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
    renderPlay({ sessions: [session("game.exe", 120)] });
    expect(screen.getByText("Live monitor")).toBeInTheDocument();
    expect(screen.getByText("In-game overlay")).toBeInTheDocument();
    // Game name is prettified for display — the ".exe" is stripped (smalls §4).
    expect(screen.getByText("game")).toBeInTheDocument();
  });

  it("honest empty state when no sessions", () => {
    renderPlay({ sessions: [] });
    expect(screen.getByText(/Play a session to see this/)).toBeInTheDocument();
  });

  it("a session row expands the full debrief IN PLACE (no route) — navigation never teleports", () => {
    renderPlay({ sessions: [session("doom.exe", 144)] });
    const row = screen.getByRole("button", { name: /doom/ });
    expect(row.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    // The full debrief verdict heading now renders inline. Match the heading forms specifically
    // (not a bare "smooth") so this doesn't also collide with the one-word short-verdict chip, which
    // the gradeLow1 alignment now lets read "Smooth" for this same fixture.
    expect(screen.getByText(/Smooth session|Mostly smooth|Rough —/i)).toBeInTheDocument();
  });

  // ── view prop (Monitor restructure, spec 2026-06-21): the Monitor shell renders Play twice ──
  it('view="sessions" shows the last-session hero + sessions, NOT the live/overlay cards', () => {
    renderPlay({ view: "sessions", sessions: [session("halo.exe", 120)] });
    expect(screen.getByText("avg FPS")).toBeInTheDocument(); // the hero (unique label)
    expect(screen.getByText("Recent sessions")).toBeInTheDocument();
    expect(screen.queryByText("Live monitor")).toBeNull();
    expect(screen.queryByText("In-game overlay")).toBeNull();
  });

  it('view="live" shows the live monitor + overlay, NOT the sessions list', () => {
    renderPlay({ view: "live", sessions: [session("halo.exe", 120)] });
    expect(screen.getByText("Live monitor")).toBeInTheDocument();
    expect(screen.getByText("In-game overlay")).toBeInTheDocument();
    expect(screen.queryByText("Recent sessions")).toBeNull();
    expect(screen.queryByText("avg FPS")).toBeNull(); // no hero in live
  });

  it('default view ("all") shows BOTH halves (flag-off, byte-identical)', () => {
    renderPlay({ sessions: [session("halo.exe", 120)] });
    expect(screen.getByText("Live monitor")).toBeInTheDocument();
    expect(screen.getByText("Recent sessions")).toBeInTheDocument();
    expect(screen.queryByText("avg FPS")).toBeNull(); // hero is sessions-view-only, not in "all"
  });

  // V2-8: the additive onFpsActive callback mirrors the ALREADY-polled get_fps_status state up
  // (so MonitorV2 can close its door during a live session) — same read, no second IPC. Kept
  // last in the file: it swaps the invoke mock's implementation and restores it after.
  it("mirrors the polled capture state up via onFpsActive", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockImplementation((cmd: string) =>
      cmd === "get_fps_status"
        ? Promise.resolve({ active: true, status: "capturing", sample: null })
        : Promise.resolve(null),
    );
    const onFpsActive = vi.fn();
    renderPlay({ view: "live", onFpsActive });
    await waitFor(() => expect(onFpsActive).toHaveBeenLastCalledWith(true));
    vi.mocked(invoke).mockImplementation(() => Promise.resolve(null));
  });
});

// THE COARSE DURATION (02-live-approved.png: "13m", not "13m 24s"). Two properties worth pinning:
// the seconds go away, and the SUB-MINUTE case does not — "0m" would be a worse reading than the
// precision it saves, and a 40-second capture is exactly when a user is watching the clock.
describe("fmtDurCoarse — the comp's session-length register", () => {
  it("drops the seconds above a minute and keeps them below one", () => {
    expect(fmtDurCoarse(804)).toBe("13m");
    expect(fmtDurCoarse(780)).toBe("13m");
    expect(fmtDurCoarse(60)).toBe("1m");
    expect(fmtDurCoarse(59)).toBe("59s");
    expect(fmtDurCoarse(0)).toBe("0s");
    expect(fmtDurCoarse(5025)).toBe("1h 23m");
  });

  it("leaves fmtDur exact — the session list still states the whole length", () => {
    expect(fmtDur(804)).toBe("13m 24s");
  });
});
