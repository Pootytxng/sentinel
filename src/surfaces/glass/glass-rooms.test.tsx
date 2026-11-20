import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within, waitFor } from "@testing-library/react";
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

  // Codebase review 2026-11-02: a dismissed check keeps its "attention" status, so the card named it
  // as worth a look beside a heading that said everything was set up right.
  it("never names a check the user dismissed", () => {
    home({ readiness: { ...readiness(1), attention_count: 0, dismissed_ids: ["att0"] } });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Your PC looks set up right");
    const checks = screen.getByRole("button", { name: /Windows setup/ });
    expect(checks.textContent).not.toContain("Memory speed 0");
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

  // CR-zh-backend-home (view-1112a/14-home-zh-CN.png): the band printed Black Box's English sentence.
  it("in zh-CN the crash band is in Chinese, keeps the app's own name and says nothing in English", async () => {
    const { default: i18n } = await import("../../i18n");
    await i18n.changeLanguage("zh-CN");
    try {
      home({
        pendingCare: {
          ...care,
          app_label: "ROB RUN",
          occurred_at: "2026-11-11T14:36:00-08:00",
          occurred_display: "Nov 11, 2:36 PM",
          summary: "ROB RUN stopped working and closed — Nov 11, 2:36 PM",
        },
      });
      const band = document.querySelector(".gl-banner")!;
      expect(band.textContent).toContain("ROB RUN 已停止工作并关闭");
      expect(band.textContent).toContain("11月11日");
      expect(band.textContent).not.toMatch(/stopped working|Nov 11/);
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("the Last session card shows the 1% low the other cards lack, not the average again (desk review 2026-10-30)", () => {
    home();
    const last = screen.getByRole("button", { name: /Last session/ });
    expect(last.textContent).toMatch(/96\s*fps 1% low/);
    expect(last.textContent).not.toContain("141");
    // The average is on the game's own card.
    expect(screen.getByRole("button", { name: "Open eldenring" }).textContent).toContain("141");
  });

  // s44 batch 2 (B2): "3 things are worth a look" must name all 3 where the page can be read; the
  // checks card used to name only the first two.
  it("names every check the heading counts, not only the first two", () => {
    home({ readiness: readiness(3) });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("3 things are worth a look");
    const card = screen.getByRole("button", { name: /Windows setup/ }).textContent ?? "";
    for (const n of ["Memory speed 0", "Memory speed 1", "Memory speed 2"]) expect(card).toContain(n);
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

  // Desk review 2026-11-03 (his rig: 14 ready, network QoS and VRR advisory): the card said "16 of 16
  // checks look right" over two checks Compy notes but doesn't grade.
  it("advisory checks leave the ratio and are named on the card, never counted as right", () => {
    const base = readiness(0);
    const withAdvisory: GameReadiness = {
      ...base,
      checks: base.checks.map((c, i) => (i >= 8 ? { ...c, status: "advisory" as const } : c)),
      ready_count: 8,
      advisory_count: 2,
    };
    home({ readiness: withAdvisory });
    const card = screen.getByRole("button", { name: /Windows setup/ });
    expect(card.textContent).toMatch(/8\s*of 8 checks look right/);
    expect(card.textContent).toContain("2 advisory, not graded");
    expect(card.textContent).not.toMatch(/10\s*of 10/);
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

  // CR-zh-readiness-words (view-1112a/14-home-zh-CN.png): zh-CN printed readiness.rs's English title
  // and body for the owner's power plan; the plan's own name stays as Windows has it.
  it("zh-CN: the power-plan limiter reads in Chinese with the plan's name untranslated; English unchanged", async () => {
    const label = "Power plan isn't performance-oriented";
    const detail =
      'Active plan "Synez Power Plan". A performance plan (High performance / Ultimate Performance) can reduce latency. Compy won\'t switch it for you.';
    const r = readiness(0);
    const withPlan: GameReadiness = {
      ...r,
      checks: [...r.checks, { id: "power-profile", label, status: "attention", detail, value: "Synez Power Plan" }],
      attention_count: 1,
    };
    const priorities: Priorities = {
      ...noLimiters,
      limiters: [{ id: "power-profile", title: label, reason: detail, linked: "power-profile", confidence: "medium", status: "attention" }],
    };
    home({ readiness: withPlan, priorities });
    expect(limiter().textContent).toContain(label);
    expect(limiter().textContent).toContain(detail);
    cleanup();
    const { default: i18n } = await import("../../i18n");
    await i18n.changeLanguage("zh-CN");
    try {
      home({ readiness: withPlan, priorities });
      // The card's name is Chinese here too; found by its heading's id.
      const text = document.querySelector('[aria-labelledby="gl-home-limiter"]')!.textContent!;
      expect(text).toContain("电源计划不是性能优先");
      expect(text).toContain("“Synez Power Plan”");
      expect(text).not.toMatch(/performance-oriented|Active plan|switch it/);
    } finally {
      await i18n.changeLanguage("en");
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
  it("F5: card notes and card subs take the muted ink (AA on glass), never the faint", () => {
    const css = glassCss();
    for (const sel of [':root[data-v2="on"] .gl-kpi-note', ':root[data-v2="on"] .gl-card-sub']) {
      expect(body(css, sel), sel).toMatch(/color:\s*var\(--v2-muted\)/);
    }
  });

  // Desk reviews 2026-11-02, on his rig: F5 lifted the stutter tag alone, and 151 of the station's 152
  // "not a proven cause" tags still wore the faint ink, 3.74-4.20:1; round 2 found 166 more faint lines
  // in the station at 3.03-4.47:1, the teal next-step and assess blocks the worst. Black Box's sheets
  // read --ix-text-3, so the station re-points that one ink instead of chasing selectors.
  it("the station lifts the faint ink its Black Box sheets read, past AA on the teal blocks", () => {
    const station = body(glassCss(), ':root[data-v2="on"] .gl-station');
    expect(station, "the station kept the instrument layer's faint ink").toMatch(
      /--ix-text-3:\s*color-mix\(in srgb, var\(--v2-muted\) 70%, var\(--v2-text\)\)/,
    );
    // One ink for the whole tier: no per-tag colour left behind to drift from it.
    expect(rules(glassCss()).some(([s]) => /\.bb-(stutter|changed|since)-tag/.test(s))).toBe(false);
  });

  // Same reviews, Test room: on see-through panels the faint tier read 4.23-4.48:1 on his backdrop.
  it("on glass and frosted the faint tier takes the muted ink; Solid keeps its own", () => {
    const tokens = read("src", "design", "tokens-v2.css");
    const lift = ':root[data-v2="on"]:is([data-surface="glass"], [data-surface="frosted"])';
    expect(body(tokens, lift)).toMatch(/--v2-faint:\s*var\(--v2-muted\)/);
    // Review round 2: a check that Solid's own rule lacks the token passed vacuously, as no such rule
    // exists. What keeps Solid on its own ink is that only the base rule and the glass/frosted lift
    // declare the token at all.
    const declaring = rules(tokens)
      .filter(([, d]) => /(^|[;\s])--v2-faint\s*:/.test(d))
      .map(([s]) => s);
    expect(declaring).toHaveLength(2);
    expect(declaring).toContain(lift);
    expect(declaring.filter((s) => s !== lift).every((s) => !/data-surface/.test(s))).toBe(true);
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

  it("the record shows up already scrolled to: the scroll lands in the commit that draws it (CR-glass-scroll-flake)", async () => {
    // The scroll ran from a passive effect, which React runs in a later task than the commit that
    // draws the row. A loaded run (the pre-push gate) let the test read the row in that gap, and a
    // user saw one frame of the list's top before it jumped. A DOM observer fires right after the
    // commit, before any later task: the scroll must already have happened by then.
    scan.report = {
      incidents: [
        {
          incident_id: "tail0000000000002",
          headline: "tail stopped responding (froze)",
          tag: "App hang",
          when: "2026-09-28T10:00:00Z",
          when_display: "2026-09-28T10:00:00Z",
          vitals: null,
          receipt: { source: "Application log · 1002", event_ids: [1002], faulting_app: null, faulting_module: null, code: null, detail: "" },
          assessment: null,
        },
      ],
      skipped_sources: [],
    };
    const scrolled = vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
    // null = the observer never saw the note; otherwise whether the note's own row had been scrolled to.
    let rowScrolledWhenDrawn: boolean | null = null;
    const watch = new MutationObserver(() => {
      const note = document.querySelector(".bb-selected-note");
      if (rowScrolledWhenDrawn === null && note) {
        const row = note.closest(".bb-item");
        rowScrolledWhenDrawn = scrolled.mock.contexts.some((el) => el === row);
      }
    });
    watch.observe(document.body, { childList: true, subtree: true });
    try {
      render(
        <ProblemsRoom
          changes={[]}
          onChanged={vi.fn()}
          ledgerBusy={false}
          onLedgerBusy={vi.fn()}
          focusIncidentId={null}
          pendingIncidentId="tail0000000000002"
        />,
      );
      await screen.findByText("This is the one you came here to see.");
      expect(rowScrolledWhenDrawn, "the observer never saw the note").not.toBeNull();
      expect(rowScrolledWhenDrawn, "the row was drawn before it was scrolled to").toBe(true);
    } finally {
      watch.disconnect();
      scrolled.mockRestore();
    }
  });
});

// Round-2 review 2026-10-31: games recorded but no frame rate measured (a session Compy saw but
// couldn't read). The page said "No session yet" beside cards counting "1 session", "2 games
// measured" beside two "Not measured" cards, and drew an empty chart with ticks "0 1 1 2".
describe("Health summary when games were recorded but nothing was measured", () => {
  const unmeasured = [
    session({ process_name: "eldenring.exe", avg_fps: 0, low1_fps_est: 0 }),
    session({ process_name: "pbz.exe", started_at: "2026-10-28T20:00:00Z", avg_fps: 0, low1_fps_est: 0 }),
  ];

  it("never claims a measurement and never says no session was recorded", () => {
    home({ sessions: unmeasured });
    const page = document.querySelector(".gl-room")!.textContent ?? "";
    expect(page).not.toMatch(/No session yet/);
    expect(page).not.toMatch(/games? measured|has measured/);
    const last = screen.getByRole("button", { name: /Last session/ });
    expect(last.textContent).toContain("Not measured");
    expect(last.textContent).toMatch(/eldenring's last session wasn't measured/);
  });

  it("draws no chart when no bar has a value", () => {
    home({ sessions: unmeasured });
    expect(document.querySelector('[aria-labelledby="gl-home-chart"]')).toBeNull();
    expect(document.querySelector(".gl-lower")!.getAttribute("data-chart")).toBe("none");
  });
});

describe("TubeChart axis", () => {
  it("prints whole, unique ticks even when nothing was measured", async () => {
    const { TubeChart } = await import("./TubeChart");
    const { container } = render(
      <TubeChart
        ariaLabel="test"
        bars={[
          { key: "a", value: null, label: "Oct 1", tip: "" },
          { key: "b", value: null, label: "Oct 2", tip: "" },
        ]}
      />,
    );
    const ticks = [...container.querySelectorAll("svg > g > text")].map((n) => n.textContent);
    expect(ticks.length).toBeGreaterThan(1);
    expect(new Set(ticks).size).toBe(ticks.length);
  });
});

describe("Home: one entry point for 'something's wrong'", () => {
  it("without the crash banner the header's 'Something went wrong' opens the Paramedic card and moves focus to it, not the Problems page", async () => {
    const p = home({ pendingCare: null });
    fireEvent.click(screen.getByRole("button", { name: "Something went wrong" }));
    await waitFor(() => expect(invoked).toContain("paramedic_diagnose"));
    expect(document.activeElement).toBe(screen.getByTestId("paramedic"));
    expect(p.onOpenProblems).not.toHaveBeenCalled();
  });

  it("while the crash banner is showing the header button keeps its old job and opens Problems; the banner and the card are untouched", () => {
    const p = home({ pendingCare: care });
    fireEvent.click(screen.getByRole("button", { name: "Something went wrong" }));
    expect(p.onOpenProblems).toHaveBeenCalledTimes(1);
    expect(invoked).not.toContain("paramedic_diagnose");
    // The crash banner's own two buttons are still there, and so is the card below.
    expect(screen.getByRole("button", { name: "Find out why" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Not now" })).toBeTruthy();
    expect(screen.getByTestId("paramedic")).toBeTruthy();
  });

  it("with no recorded game there is no card, so the header button still opens Problems", () => {
    const p = home({ sessions: [] });
    expect(screen.queryByTestId("paramedic")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Something went wrong" }));
    expect(p.onOpenProblems).toHaveBeenCalledTimes(1);
    expect(invoked).not.toContain("paramedic_diagnose");
  });
});
