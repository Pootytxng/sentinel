import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";

const invoked: string[] = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    invoked.push(cmd);
    return Promise.resolve(null);
  },
}));

import "../../i18n";
import type { GameReadiness, PendingCareIncident, SessionSummary } from "../../types";
import { HomeGlass } from "./HomeGlass";
import { GamesRoom } from "./GamesRoom";
import { ProblemsRoom } from "./ProblemsRoom";

afterEach(() => {
  cleanup();
  invoked.length = 0;
});

const session = (over: Partial<SessionSummary>): SessionSummary =>
  ({
    started_at: "2026-10-29T20:00:00Z",
    duration_secs: 2820,
    process_name: "eldenring.exe",
    samples: 2800,
    avg_fps: 141,
    avg_frametime_ms: 7.1,
    low1_fps_est: 96,
    peak_gpu_temp_c: null,
    peak_gpu_usage_pct: null,
    peak_ram_used_bytes: null,
    ram_total_bytes: null,
    compy_changes_active: null,
    ...over,
  }) as SessionSummary;

const readiness = (attention: number, unknown = 0): GameReadiness => ({
  checks: [
    ...Array.from({ length: 10 - attention - unknown }, (_, i) => ({ id: `ok${i}`, label: `Ok ${i}`, status: "ready" as const, detail: "", value: null })),
    ...Array.from({ length: attention }, (_, i) => ({ id: `att${i}`, label: `Memory speed ${i}`, status: "attention" as const, detail: "", value: null })),
    ...Array.from({ length: unknown }, (_, i) => ({ id: `unk${i}`, label: `Unread ${i}`, status: "unknown" as const, detail: "", value: null })),
  ],
  ready_count: 10 - attention - unknown,
  attention_count: attention,
  unknown_count: unknown,
  advisory_count: 0,
  advisory: "",
  dismissed_ids: [],
  drifts: [],
});

const care: PendingCareIncident = {
  incident_id: "inc-1",
  occurred_at: "2026-10-30T13:44:00-07:00",
  occurred_display: "Oct 30, 1:44 PM",
  kind: "App crash",
  app_label: "Elden Ring",
  summary: "",
};

function home(over: Partial<Parameters<typeof HomeGlass>[0]> = {}) {
  const props = {
    readiness: readiness(0),
    priorities: null,
    sessions: [session({})],
    pendingCare: null,
    onOpenCareIncident: vi.fn(),
    onDismissCareIncident: vi.fn(),
    onOpenGame: vi.fn(),
    onOpenProblems: vi.fn(),
    onOpenLive: vi.fn(),
    onRunCheck: vi.fn(),
    onSeeChecks: vi.fn(),
    onOpenDetails: vi.fn(),
    ...over,
  };
  render(<HomeGlass {...props} />);
  return props;
}

describe("Health summary (glass redesign)", () => {
  it("answers 'set up right' only when every readable check is fine and nothing was recorded", () => {
    home();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Your PC looks set up right");
    expect(screen.getByText(/10 of 10 checks look right/)).toBeTruthy();
  });

  it("counts a crash Windows recorded as a thing worth a look, in its own band with both actions", () => {
    const p = home({ pendingCare: care });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("1 thing is worth a look");
    const band = screen.getByRole("group", { name: "Needs a look" });
    expect(within(band).getByText("Elden Ring closed unexpectedly")).toBeTruthy();
    fireEvent.click(within(band).getByRole("button", { name: "Find out why" }));
    expect(p.onOpenCareIncident).toHaveBeenCalledWith("inc-1");
    fireEvent.click(within(band).getByRole("button", { name: "Not now" }));
    expect(p.onDismissCareIncident).toHaveBeenCalledWith("inc-1");
  });

  it("never grades what it could not read: unknown checks leave the ratio, and no checks means 'Run a check'", () => {
    home({ readiness: readiness(1, 2) });
    expect(screen.getByText(/7 of 8 checks look right/)).toBeTruthy();
    cleanup();
    const p = home({ readiness: null });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Here's how your PC is doing");
    fireEvent.click(screen.getByText("Run a check"));
    expect(p.onRunCheck).toHaveBeenCalled();
  });

  it("opens a game's page from its card and the Games door from 'Improve a game'", () => {
    const p = home();
    fireEvent.click(screen.getByRole("button", { name: "Open eldenring" }));
    expect(p.onOpenGame).toHaveBeenCalledWith("eldenring.exe");
    fireEvent.click(screen.getByRole("button", { name: /Improve a game/ }));
    expect(p.onOpenGame).toHaveBeenCalledWith(null);
  });
});

describe("Games (glass redesign)", () => {
  it("with no measured session, says so and offers Live", () => {
    const onOpenLive = vi.fn();
    render(<GamesRoom sessions={[]} onOpenLive={onOpenLive} onOpenTest={vi.fn()} />);
    expect(screen.getByText(/No games yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Live" }));
    expect(onOpenLive).toHaveBeenCalled();
  });

  it("opens a game's page with real readings and says 'Not measured' for what was not", () => {
    render(
      <GamesRoom
        sessions={[session({}), session({ started_at: "2026-10-28T20:00:00Z", low1_fps_est: 0 })]}
        onOpenLive={vi.fn()}
        onOpenTest={vi.fn()}
        focusKey="eldenring.exe"
      />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("eldenring");
    expect(screen.getAllByText("141").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "All games" }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Games");
  });
});

describe("Problems (glass redesign)", () => {
  it("is Crash & Freeze Rescue behind its own door, scanning on arrival", async () => {
    render(
      <ProblemsRoom changes={[]} onChanged={vi.fn()} ledgerBusy={false} onLedgerBusy={vi.fn()} focusIncidentId={null} />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Problems");
    await new Promise((r) => setTimeout(r, 0));
    expect(invoked).toContain("get_crash_blackbox");
  });
});
