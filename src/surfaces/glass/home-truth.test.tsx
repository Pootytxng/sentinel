// B1 Home truth (owner decision 2026-11-21). Home's headline and count come from what is off-normal: a watched
// setting that drifted, a game the Paramedic measured running rougher than usual (read once from the session
// store when Home opens), a failed read. An optional tweak the owner has not applied is never counted or shown
// on Home (Constitution §38 "brake light fluid"); it stays in the Lab.
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
import type { GameReadiness, Priorities, ReadinessCheck } from "../../types";
import { HomeGlass } from "./HomeGlass";

beforeEach(() => {
  engine.status = { rough: [] };
  engine.fail = false;
  engine.calls = [];
});
afterEach(cleanup);

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

// What priorities.rs hands Home today when the one tweak not applied is "Trim Windows visual effects".
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

const robRun = { game: "robrun.exe", game_name: "ROB RUN", rough_sessions: 2, newest_rough_at: "2026-11-20T03:51:22Z" };

function home(withDrift: boolean) {
  return render(
    <HomeGlass
      readiness={readiness(withDrift)}
      priorities={tweakOnly}
      sessions={[]}
      pendingCare={null}
      onOpenCareIncident={vi.fn()}
      onDismissCareIncident={vi.fn()}
      onOpenGame={vi.fn()}
      onOpenLive={vi.fn()}
      onRunCheck={vi.fn()}
      onSeeChecks={vi.fn()}
      onOpenDetails={vi.fn()}
    />,
  ).container;
}

describe("Home truth (B1)", () => {
  it("the owner's PC today: the drift and the rough game are counted and both named; the tweak is nowhere", async () => {
    engine.status = { rough: [robRun] };
    const c = home(true);
    expect(await screen.findByRole("heading", { level: 1, name: "2 things are worth a look" })).toBeInTheDocument();
    expect(within(screen.getByTestId("paramedic")).getByTestId("paramedic-rough")).toHaveTextContent(
      "ROB RUN's last 2 measured sessions ran rougher than its usual range.",
    );
    expect(c).toHaveTextContent("Worth a look: Compy changes were turned back off");
    expect(c.textContent).not.toMatch(/tweak|Trim Windows visual effects/i);
    expect(engine.calls.filter((x) => x === "paramedic_home_status")).toHaveLength(1);
  });

  it("a clean PC with only an unapplied tweak: 'set up right', and the tweak is not tiled or counted", async () => {
    const c = home(false);
    await screen.findByText("Nothing in the setup Compy checked stands out.");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Your PC looks set up right");
    expect(c.textContent).not.toMatch(/tweak|worth a look:/i);
    expect(screen.queryByTestId("paramedic-rough")).toBeNull();
  });

  it("a rough game alone is counted and named in the card", async () => {
    engine.status = { rough: [robRun, { ...robRun, game: "wardogs.exe", game_name: "WAR DOGS", rough_sessions: 3 }] };
    home(false);
    expect(await screen.findByRole("heading", { level: 1, name: "2 things are worth a look" })).toBeInTheDocument();
    expect(screen.getByTestId("paramedic-rough")).toHaveTextContent(
      "ROB RUN's last 2 measured sessions ran rougher than its usual range. Also running rougher than usual: WAR DOGS.",
    );
  });

  it("a failed or malformed session read never adds a game and never invents one", async () => {
    // Lets the session read settle (resolve or reject) before the page is read.
    const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    engine.fail = true;
    home(false);
    await settle();
    expect(engine.calls).toContain("paramedic_home_status");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Your PC looks set up right");
    expect(screen.queryByTestId("paramedic-rough")).toBeNull();
    cleanup();
    engine.fail = false;
    // A count that is not a whole number: the whole answer is a failed read, not one rough game.
    engine.status = { rough: [{ ...robRun, rough_sessions: "2" }] };
    home(true);
    await settle();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("1 thing is worth a look");
    expect(screen.queryByTestId("paramedic-rough")).toBeNull();
  });
});
