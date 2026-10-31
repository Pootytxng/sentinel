import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";

const invoked: string[] = [];
// Settable per-test scan answer (vi.mock factories are hoisted, so this must be too).
const scan = vi.hoisted(() => ({ report: null as unknown }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    invoked.push(cmd);
    if (cmd === "get_crash_blackbox") return Promise.resolve(scan.report);
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
  scan.report = null;
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
  summary: "Elden Ring closed unexpectedly",
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
    const checks = screen.getByRole("button", { name: /Windows setup/ });
    expect(checks.textContent).toMatch(/10\s*of 10 checks look right/);
    expect(checks.textContent).toContain("No check needs a look");
  });

  it("puts nothing under the answer: the header is a title, its facts live on the cards (desk review 2026-10-30)", () => {
    home();
    const head = document.querySelector(".gl-head-text")!;
    expect(head.querySelector(".gl-sub")).toBeNull();
    expect(head.textContent).not.toMatch(/checks look right|until you choose/);
  });

  it("says a freeze stopped responding, in Black Box's own words, never 'closed unexpectedly' (desk review 2026-10-30)", () => {
    home({
      pendingCare: {
        ...care,
        kind: "App hang",
        app_label: "tail",
        occurred_display: "Sep 28, 11:57 AM",
        // Black Box builds every headline as "{what happened} — {when}".
        summary: "tail stopped responding (froze) — Sep 28, 11:57 AM",
      },
    });
    const band = screen.getByRole("group", { name: "Needs a look" });
    expect(within(band).getByText("tail stopped responding (froze) — Sep 28, 11:57 AM")).toBeTruthy();
    expect(band.textContent).not.toMatch(/closed unexpectedly/);
    // Round 2: the line under it does not say the time (or the kind) a second time.
    expect(band.textContent!.split("Sep 28, 11:57 AM").length - 1).toBe(1);
    expect(band.textContent).not.toContain("App hang");
  });

  it("the Last session card shows the 1% low the other cards lack, not the average again (desk review 2026-10-30)", () => {
    home();
    const last = screen.getByRole("button", { name: /Last session/ });
    expect(last.textContent).toMatch(/96\s*fps 1% low/);
    expect(last.textContent).not.toContain("141");
    // The average is on the game's own card.
    expect(screen.getByRole("button", { name: "Open eldenring" }).textContent).toContain("141");
  });

  it("counts a crash Windows recorded as a thing worth a look, in its own band with both actions", () => {
    const p = home({ pendingCare: care });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("1 thing is worth a look");
    const band = screen.getByRole("group", { name: "Needs a look" });
    expect(within(band).getByText("Elden Ring closed unexpectedly")).toBeTruthy();
    // The checks card speaks for the checks only, so it cannot contradict the answer's count.
    expect(screen.getByRole("button", { name: /Windows setup/ }).textContent).toContain("No check needs a look");
    fireEvent.click(within(band).getByRole("button", { name: "Find out why" }));
    expect(p.onOpenCareIncident).toHaveBeenCalledWith("inc-1");
    fireEvent.click(within(band).getByRole("button", { name: "Not now" }));
    expect(p.onDismissCareIncident).toHaveBeenCalledWith("inc-1");
  });

  it("never grades what it could not read: unknown checks leave the ratio, and no checks means 'Run a check'", () => {
    home({ readiness: readiness(1, 2) });
    expect(screen.getByRole("button", { name: /Windows setup/ }).textContent).toMatch(/7\s*of 8 checks look right/);
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
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("How your games run");
  });

  it("never prints the room's name as its h1 (the top bar has it) and has no sub line (desk review 2026-10-30)", () => {
    render(<GamesRoom sessions={[session({})]} onOpenLive={vi.fn()} onOpenTest={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).not.toBe("Games");
    expect(document.querySelector(".gl-sub")).toBeNull();
    cleanup();
    render(<GamesRoom sessions={[session({})]} onOpenLive={vi.fn()} onOpenTest={vi.fn()} focusKey="eldenring.exe" />);
    expect(document.querySelector(".gl-sub")).toBeNull();
  });
});

describe("Problems (glass redesign)", () => {
  it("is Crash & Freeze Rescue behind its own door, scanning on arrival", async () => {
    render(
      <ProblemsRoom changes={[]} onChanged={vi.fn()} ledgerBusy={false} onLedgerBusy={vi.fn()} focusIncidentId={null} />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("What went wrong, and why");
    await new Promise((r) => setTimeout(r, 0));
    expect(invoked).toContain("get_crash_blackbox");
  });

  it("arriving while a record waits lands on THAT record, the one the door's dot counts (desk review 2026-10-30)", async () => {
    const incident = (id: string, headline: string, when: string) => ({
      incident_id: id,
      headline,
      tag: "App hang",
      when,
      when_display: when,
      vitals: null,
      receipt: { source: "Application log · 1002", event_ids: [1002], faulting_app: null, faulting_module: null, code: null, detail: "" },
      assessment: null,
    });
    scan.report = {
      incidents: [
        incident("chatgpt0000000001", "ChatGPT stopped responding (froze)", "2026-10-28T10:00:00Z"),
        incident("tail0000000000001", "tail stopped responding (froze)", "2026-09-28T10:00:00Z"),
      ],
      skipped_sources: [],
    };
    const scrolled = vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
    render(
      <ProblemsRoom
        changes={[]}
        onChanged={vi.fn()}
        ledgerBusy={false}
        onLedgerBusy={vi.fn()}
        focusIncidentId={null}
        pendingIncidentId="tail0000000000001"
      />,
    );
    const note = await screen.findByText("This is the one you came here to see.");
    const row = note.closest(".bb-item")!;
    expect(row.textContent).toContain("tail stopped responding");
    // Round 2: it lands by its top. A record with its evidence open is taller than the window, and
    // centring it left the note and the headline above the fold.
    const call = scrolled.mock.contexts.findIndex((el) => el === row);
    expect(call, "the selected row was never scrolled to").toBeGreaterThan(-1);
    expect(scrolled.mock.calls[call][0]).toMatchObject({ block: "start" });
    scrolled.mockRestore();
    // Read-only: arriving does not mark the record opened.
    expect(invoked).not.toContain("mark_care_incident_opened");
  });
});
