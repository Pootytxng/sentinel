// B1 Home truth (owner decision 2026-11-21). Home's headline and count come from what is off-normal: a watched
// setting that drifted, a game the Paramedic measured rougher than usual (read from the session store when Home
// opens, and again when a session is recorded), a failed read. An optional tweak the owner has not applied is
// never counted or shown on Home (Constitution §38 "brake light fluid"); it stays in the Lab. Game titles here
// are invented.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, render, screen, cleanup, within } from "@testing-library/react";

const engine = vi.hoisted(() => ({ status: null as unknown, fail: false, calls: [] as string[] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    engine.calls.push(cmd);
    if (cmd === "paramedic_home_status") return engine.fail ? Promise.reject(new Error("unreadable")) : Promise.resolve(engine.status);
    return Promise.resolve(null);
  },
}));

import "../../i18n";
import type { GameReadiness, Priorities, ReadinessCheck, SessionSummary } from "../../types";
import { HomeGlass } from "./HomeGlass";

beforeEach(() => {
  engine.status = { rough: [], games_judged: 1 };
  engine.fail = false;
  engine.calls = [];
});
afterEach(cleanup);

// Lets the session read settle (resolve or reject) before the page is read.
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const statusCalls = () => engine.calls.filter((x) => x === "paramedic_home_status").length;

const ready = (i: number): ReadinessCheck => ({ id: `c${i}`, label: `Check ${i}`, status: "ready", detail: "", value: null });
const drift: ReadinessCheck = {
  id: "applied-changes",
  label: "Compy changes were turned back off",
  status: "attention",
  detail: "Trim Windows visual effects, a setting Compy applied, is no longer on.",
  value: null,
};

function readiness(withDrift: boolean): GameReadiness {
  const checks = [...Array.from({ length: 13 }, (_, i) => ready(i)), ...(withDrift ? [drift] : [ready(13)])];
  return {
    checks,
    ready_count: withDrift ? 13 : 14,
    attention_count: withDrift ? 1 : 0,
    unknown_count: 0,
    advisory_count: 0,
    advisory: "",
    dismissed_ids: [],
    drifts: [],
  };
}

// What priorities.rs hands Home when the one tweak not applied is "Trim Windows visual effects".
const tweakOnly: Priorities = {
  limiters: [
    {
      id: "pending-safe-recs",
      title: "1 tweak not applied",
      reason: "Compy has reversible tweaks you haven't applied: Trim Windows visual effects.",
      linked: null,
      confidence: "medium",
      status: "attention",
    },
  ],
  already_fine: [],
  not_worth_touching: [],
  session_hint: null,
  upgrade_path: null,
};

// Noon UTC: the date reads Nov 20 in every time zone the tests run in.
const skyline = { game: "skylinedrift.exe", game_name: "Skyline Drift", rough_sessions: 2, newest_rough_at: "2026-11-20T12:00:00Z" };

const session = (at: string) =>
  ({
    started_at: at,
    duration_secs: 1200,
    process_name: "skylinedrift.exe",
    samples: 1200,
    avg_fps: 120,
    avg_frametime_ms: 8.3,
    low1_fps_est: 80,
    peak_gpu_temp_c: null,
    peak_gpu_usage_pct: null,
    peak_ram_used_bytes: null,
    ram_total_bytes: null,
    compy_changes_active: null,
  }) as SessionSummary;

function homeEl(withDrift: boolean, sessions: SessionSummary[] = []) {
  return (
    <HomeGlass
      readiness={readiness(withDrift)}
      priorities={tweakOnly}
      sessions={sessions}
      pendingCare={null}
      onOpenCareIncident={vi.fn()}
      onDismissCareIncident={vi.fn()}
      onOpenGame={vi.fn()}
      onOpenLive={vi.fn()}
      onRunCheck={vi.fn()}
      onSeeChecks={vi.fn()}
      onOpenDetails={vi.fn()}
    />
  );
}
const home = (withDrift: boolean, sessions: SessionSummary[] = []) => render(homeEl(withDrift, sessions)).container;

describe("Home truth (B1)", () => {
  it("the owner's PC today: the drift and the rough game are counted and both named; the tweak is nowhere", async () => {
    engine.status = { rough: [skyline], games_judged: 3 };
    const c = home(true);
    expect(await screen.findByRole("heading", { level: 1, name: "2 things are worth a look" })).toBeInTheDocument();
    expect(within(screen.getByTestId("paramedic")).getByTestId("paramedic-rough")).toHaveTextContent(
      "Skyline Drift's last 2 measured sessions in a row, up to Nov 20, ran rougher than its usual range.",
    );
    expect(c).toHaveTextContent("Worth a look: Compy changes were turned back off");
    expect(c.textContent).not.toMatch(/tweak|Trim Windows visual effects/i);
    expect(statusCalls()).toBe(1);
  });

  it("a clean PC with only an unapplied tweak: 'set up right', and the tweak is not tiled or counted", async () => {
    const c = home(false);
    await settle();
    expect(statusCalls()).toBe(1);
    expect(screen.getByText("Nothing in the setup Compy checked stands out.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Your PC looks set up right");
    expect(c.textContent).not.toMatch(/tweak|worth a look:/i);
    expect(screen.queryByTestId("paramedic-rough")).toBeNull();
  });

  it("two rough games are counted and both named in the card", async () => {
    engine.status = { rough: [skyline, { ...skyline, game: "harbornine.exe", game_name: "Harbor Nine", rough_sessions: 3 }], games_judged: 2 };
    home(false);
    expect(await screen.findByRole("heading", { level: 1, name: "2 things are worth a look" })).toBeInTheDocument();
    expect(screen.getByTestId("paramedic-rough")).toHaveTextContent(
      "Skyline Drift's last 2 measured sessions in a row, up to Nov 20, ran rougher than its usual range. Also rougher than usual last time: Harbor Nine.",
    );
  });

  it("a failed session read is said in the card and adds no game; a malformed one is a failed read too", async () => {
    engine.fail = true;
    home(false);
    await settle();
    expect(statusCalls()).toBe(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Your PC looks set up right");
    expect(screen.getByTestId("paramedic-rough")).toHaveTextContent("Compy couldn't read how your games ran.");
    cleanup();
    engine.fail = false;
    // A count that is not a whole number: the whole answer is a failed read, not one rough game.
    engine.status = { rough: [{ ...skyline, rough_sessions: "2" }], games_judged: 1 };
    home(true);
    await settle();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("1 thing is worth a look");
    expect(screen.getByTestId("paramedic-rough")).toHaveTextContent("Compy couldn't read how your games ran.");
    expect(screen.getByTestId("paramedic-rough")).not.toHaveTextContent(/Skyline Drift/);
  });

  it("a session recorded while Home stays open reads again, and the old answer does not stay up", async () => {
    engine.status = { rough: [skyline], games_judged: 1 };
    const first = [session("2026-11-20T12:00:00Z")];
    const { rerender } = render(homeEl(false, first));
    await settle();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("1 thing is worth a look");
    // The next session ran in its usual range: the engine no longer lists the game.
    engine.status = { rough: [], games_judged: 1 };
    rerender(homeEl(false, [session("2026-11-21T12:00:00Z"), ...first]));
    await settle();
    expect(statusCalls()).toBe(2);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Your PC looks set up right");
    expect(screen.queryByTestId("paramedic-rough")).toBeNull();
    // The same list again does not read again.
    rerender(homeEl(false, [session("2026-11-21T12:00:00Z"), ...first]));
    await settle();
    expect(statusCalls()).toBe(2);
  });
});
