// B1 Home truth, review r1 B1/B2: what the full health check (HomeConsole) RENDERS for a game the Paramedic
// measured rougher than usual. postureLine's return value is pinned in command-center-data.test.ts; this pins
// the face, which hides the dek in a flagged-check state. Game titles are invented.
import { describe, it, expect, vi, afterEach, beforeEach, beforeAll } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { ShellV2 } from "../design/ShellV2";
import { railFor } from "../design/homeRail";
import { HomeConsole } from "./HomeConsole";
import "../i18n";
import type { GameReadiness, Priorities, ReadinessCheck, SessionSummary } from "../types";
import type { HardwareInfo } from "../App";

const engine = vi.hoisted(() => ({ status: null as unknown }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => (cmd === "paramedic_home_status" ? Promise.resolve(engine.status) : Promise.resolve(null)),
}));
vi.mock("../design/use-motion", () => ({ useReducedMotion: () => true }));
vi.mock("./rig/RigHologram", () => ({ RigHologram: () => <div data-testid="rig-hologram" /> }));

beforeAll(() => {
  class Inert {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (globalThis as Record<string, unknown>).ResizeObserver ??= Inert;
  (globalThis as Record<string, unknown>).IntersectionObserver ??= Inert;
});
beforeEach(() => localStorage.clear());
afterEach(cleanup);

const hw = {
  cpu_brand: "CPU",
  cpu_cores_logical: 8,
  cpu_cores_physical: 4,
  cpu_frequency_mhz: 4000,
  ram_total_bytes: 16 * 1024 ** 3,
  ram_used_bytes: 8 * 1024 ** 3,
  gpus: [{ name: "GPU", vram_bytes: 8 * 1024 ** 3 }],
  disks: [],
  memory_modules: [],
  physical_disks: [],
  display: { current_refresh_rate_hz: 144 },
  os_name: "Windows",
  os_version: "11",
} as unknown as HardwareInfo;

const ready = (id: string): ReadinessCheck => ({ id, label: id, status: "ready", detail: "", value: null });
const drift: ReadinessCheck = {
  id: "applied-changes",
  label: "Compy changes were turned back off",
  status: "attention",
  detail: "Trim Windows visual effects, a setting Compy applied, is no longer on.",
  value: null,
};
const readiness = (withDrift: boolean): GameReadiness => {
  const checks = [ready("a"), ready("b"), ready("c"), ...(withDrift ? [drift] : [])];
  return {
    checks,
    ready_count: 3,
    attention_count: withDrift ? 1 : 0,
    unknown_count: 0,
    advisory_count: 0,
    advisory: "",
    dismissed_ids: [],
    drifts: [],
  };
};
const priorities: Priorities = { limiters: [], already_fine: [], not_worth_touching: [], session_hint: null, upgrade_path: null };
const skyline = { game: "skylinedrift.exe", game_name: "Skyline Drift", rough_sessions: 2, newest_rough_at: "2026-11-20T12:00:00Z" };
const ROUGH = "Skyline Drift's last 2 measured sessions in a row, up to Nov 20, ran rougher than its usual range.";

async function mount(withDrift: boolean) {
  const r = render(
    <ShellV2 items={railFor(true)} activeId="home" onNavigate={() => {}} ledger={[]}>
      <HomeConsole
        hw={hw}
        readiness={readiness(withDrift)}
        priorities={priorities}
        sessions={[] as SessionSummary[]}
        changes={[]}
        onRunCheck={() => {}}
        onSeeInFix={() => {}}
        fixRoomLabel="Lab"
      />
    </ShellV2>,
  );
  await act(async () => {
    await new Promise((res) => setTimeout(res, 0));
  });
  return r.container;
}

describe("HomeConsole renders the rough game (B1 review r1)", () => {
  it("rough game only: the measured sentence is the dek; no checks count, no Lab route, the light is not 'ok'", async () => {
    engine.status = { rough: [skyline], games_judged: 1 };
    const c = await mount(false);
    expect(c.querySelector(".hc-headline")).toHaveTextContent("Skyline Drift ran rougher than usual last time");
    expect(c.querySelector(".hc-verdict-dek")).toHaveTextContent(ROUGH);
    const sub = c.querySelector(".v2-verdict-sub")!;
    expect(sub.textContent).toBe(`${ROUGH} Every check Compy could read came back right.`);
    expect(screen.queryByRole("button", { name: /What to do about it/ })).toBeNull();
    expect(c.querySelector(".v2-eyebrow-dot-warn")).not.toBeNull();
    expect(c.querySelector(".v2-eyebrow-dot-ok")).toBeNull();
  });

  it("drift + rough game: the drift keeps its count and route, and the rough game is its own line, 'Separately: …'", async () => {
    engine.status = { rough: [skyline], games_judged: 1 };
    const c = await mount(true);
    expect(c.querySelector(".hc-headline")).toHaveTextContent("Compy changes were turned back off");
    expect(c).toHaveTextContent("What to do about it is in Lab.");
    const note = screen.getByTestId("home-rough-note");
    expect(note).toHaveTextContent(`Separately: ${ROUGH}`);
    // Its own element: not inside the check's count/route line.
    const route = screen.getByRole("button", { name: /What to do about it/ });
    expect(route.parentElement!.contains(note)).toBe(false);
  });
});
