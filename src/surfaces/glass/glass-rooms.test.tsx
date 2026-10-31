import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";

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
import type { GameReadiness, PendingCareIncident, Priorities, Recommendation, SessionSummary } from "../../types";
import { HomeGlass } from "./HomeGlass";
import { GamesRoom } from "./GamesRoom";
import { ProblemsRoom } from "./ProblemsRoom";
import { TrustMoment } from "../TrustMoment";

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

// ── GL-empty: the glass pages in their empty states (Playwright harness review, 2026-10-31) ──
// The CSS facts are static sheet reads, as in comp-fidelity-guard: jsdom loads no stylesheet.
const read = (...p: string[]) => readFileSync(join(...p), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");
/** Every top-level [selector, declarations] pair of a sheet, comments stripped. */
function rules(css: string): [string, string][] {
  const out: [string, string][] = [];
  for (const block of stripComments(css).split("}")) {
    const [sel, decls] = block.split("{");
    if (sel != null && decls != null) out.push([sel.trim().replace(/\s+/g, " "), decls]);
  }
  return out;
}
const body = (css: string, selector: string) => rules(css).find(([s]) => s === selector)?.[1] ?? "";
const glassCss = () => read("src", "surfaces", "glass-rooms.css");

const noLimiters: Priorities = { limiters: [], already_fine: [], not_worth_touching: [], session_hint: null, upgrade_path: null };

describe("GL-empty — 'What's holding FPS back' speaks for what it read: the setup, never a session", () => {
  // priorities.rs builds limiters from readiness, recommendations and startup; no session feeds one.
  const limiter = () => screen.getByRole("region", { name: "What's holding FPS back" });

  it("F1: no limiter in a read setup says the checked setup has nothing standing out, with no session claimed", () => {
    home({ sessions: [], priorities: noLimiters });
    expect(limiter().textContent).toContain("Nothing in the setup Compy checked stands out.");
    expect(limiter().textContent).not.toMatch(/session/i);
  });

  it("F2: priorities not back yet (or failed) says the setup is unread, and names no session", () => {
    home({ sessions: [], priorities: null });
    expect(limiter().textContent).toContain("Compy hasn't read your setup.");
    expect(limiter().textContent).not.toMatch(/session/i);
  });

  it("F1/F2 zh-CN: both lines speak of the setup, neither of a measured session", () => {
    const zh = JSON.parse(read("src", "i18n", "locales", "zh-CN", "home.json")).glass.limiter;
    for (const k of ["none", "unknown"]) {
      expect(zh[k], k).toContain("设置");
      expect(zh[k], k).not.toMatch(/实测|游戏记录|会话|上一次/);
    }
  });
});

describe("GL-empty F3 — no measured game: one block, one pointer at Live", () => {
  it("one full-width empty block stands in for the lone card and the empty chart, and only it points at Live", () => {
    const p = home({ sessions: [], priorities: noLimiters });
    const room = document.querySelector(".gl-room")!;
    const empties = room.querySelectorAll(".gl-empty");
    expect(empties).toHaveLength(1);
    // A child of the page itself, not a cell of the cards row: it runs the page's width.
    expect(empties[0].parentElement).toBe(room);
    expect(room.querySelector(".gl-kpis")).toBeNull();
    expect(room.textContent).not.toContain("None measured yet");
    expect(document.getElementById("gl-home-chart")).toBeNull();
    // No chart, so the lower band is one column (the rule is read from the sheet below).
    expect(room.querySelector(".gl-lower")!.getAttribute("data-chart")).toBe("none");
    // One "Open Live" on the page, the block's own button, wired to Live.
    const open = screen.getAllByRole("button", { name: "Open Live" });
    expect(open).toHaveLength(1);
    expect(empties[0].contains(open[0])).toBe(true);
    fireEvent.click(open[0]);
    expect(p.onOpenLive).toHaveBeenCalledTimes(1);
    // Nothing else on the page says Live or capture: not the Last session note, not the limiter.
    const rest = room.cloneNode(true) as Element;
    rest.querySelector(".gl-empty")!.remove();
    expect(rest.textContent).not.toMatch(/\bLive\b|captur/i);
    expect(screen.getByRole("button", { name: /Last session/ }).textContent).toContain("No session yet");
  });

  it("the no-chart band is a single column in the sheet", () => {
    expect(body(glassCss(), ':root[data-v2="on"] .gl-lower[data-chart="none"]')).toMatch(
      /grid-template-columns:\s*minmax\(0, 1fr\)/,
    );
  });

  it("with a measured game the cards row and the chart are as they were", () => {
    home();
    const room = document.querySelector(".gl-room")!;
    expect(room.querySelector(".gl-empty")).toBeNull();
    expect(room.querySelector(".gl-kpis")).not.toBeNull();
    expect(screen.getByRole("region", { name: "Average FPS per session" })).toBeTruthy();
    expect(room.querySelector(".gl-lower")!.hasAttribute("data-chart")).toBe(false);
  });
});

describe("GL-empty F4 — the trust demo opens below the answer, never above the page", () => {
  const DEMO: Recommendation = {
    id: "game-mode",
    title: "Game Mode",
    category: "system",
    severity: "safe",
    description: "",
    impact: "",
    downside: null,
    applies_to: "",
    currently_applied: false,
    provenance: "verified",
  };

  it("in HomeGlass's latest-change slot it renders inside the page, after the h1", () => {
    localStorage.removeItem("compy_trust_moment");
    home({
      sessions: [],
      latestChange: <TrustMoment recs={[DEMO]} changes={[]} isAppliable={() => true} onChanged={vi.fn()} />,
    });
    const demo = screen.getByRole("region", { name: "Watch Compy work" });
    expect(document.querySelector(".gl-room")!.contains(demo)).toBe(true);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.compareDocumentPosition(demo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("App mounts it in that slot for the summary view only; the full health check keeps it above its back row", () => {
    // App needs the whole Tauri surface to render, so its source order is the claim checked here.
    const app = stripComments(read("src", "App.tsx"));
    const start = app.indexOf('activeTab === "Overview" && hw ? (');
    const overview = app.slice(start, app.indexOf("<HomeRoom", start));
    const summary = overview.indexOf('homeView === "summary" ? (');
    const slot = overview.indexOf("latestChange={", overview.indexOf("<HomeGlass"));
    const details = overview.indexOf(") : (", slot);
    expect(start > -1 && summary > -1 && slot > summary && details > slot, "App's Health branch moved; re-anchor").toBe(true);
    // Nothing renders between the room's start and the summary page, so the page opens on its h1.
    expect(overview.slice(0, summary)).not.toContain("<TrustMoment");
    expect(overview.slice(slot, details)).toMatch(/<TrustMoment[\s\S]*<FirstWin/);
    const rest = overview.slice(details);
    expect(rest.indexOf("<TrustMoment")).toBeGreaterThan(-1);
    expect(rest.indexOf("<TrustMoment")).toBeLessThan(rest.indexOf('className="gl-back-row"'));
  });

  it("on glass it wears the slot's card and pill buttons, as FirstWin does there", () => {
    const css = glassCss();
    expect(body(css, ':root[data-v2="on"]:not([data-surface="solid"]) .gl-room :is(.first-win, .trust-moment)')).toMatch(
      /background:\s*var\(--v2-panel-card\)/,
    );
    expect(body(css, ':root[data-v2="on"]:not([data-surface="solid"]) .gl-room .tm-btn')).toMatch(/border-radius:\s*999px/);
  });
});

describe("GL-empty F5/F6 — legible small print, and the lane's soft foot on every surface", () => {
  it("F5: card notes, card subs and the stutter tag take the muted ink (AA on glass), never the faint", () => {
    const css = glassCss();
    for (const sel of [
      ':root[data-v2="on"] .gl-kpi-note',
      ':root[data-v2="on"] .gl-card-sub',
      ':root[data-v2="on"] .gl-station .bb-stutter-tag',
    ]) {
      expect(body(css, sel), sel).toMatch(/color:\s*var\(--v2-muted\)/);
    }
  });

  it("F6: the content lane's fade is not scoped away from Solid", () => {
    const masks = rules(read("src", "design", "shell-v2.css")).filter(([, d]) => /\bmask-image\s*:/.test(d));
    expect(masks.map(([s]) => s)).toEqual([':root[data-v2="on"] .v2-content']);
    expect(masks[0][1]).toMatch(/(^|[^-])mask-image:\s*linear-gradient\(to bottom, black calc\(100% - 22px\), transparent\)/);
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
