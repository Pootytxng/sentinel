// B1 review carry-over (B2): HomeHud and HomeV2 render the rough-game note beside a flagged check as its OWN line,
// "Separately: …", never joined to the check's detail into one sentence. Game titles are invented.
import { describe, it, expect, vi, afterEach, beforeEach, beforeAll } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { ShellV2 } from "../design/ShellV2";
import { railFor } from "../design/homeRail";
import { HomeHud } from "./HomeHud";
import { HomeV2 } from "./HomeV2";
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
const DETAIL = "Trim Windows visual effects, a setting Compy applied, is no longer on.";
const drift: ReadinessCheck = { id: "applied-changes", label: "Compy changes were turned back off", status: "attention", detail: DETAIL, value: null };
const readiness: GameReadiness = {
  checks: [ready("a"), ready("b"), ready("c"), drift],
  ready_count: 3,
  attention_count: 1,
  unknown_count: 0,
  advisory_count: 0,
  advisory: "",
  dismissed_ids: [],
  drifts: [],
};
const priorities: Priorities = { limiters: [], already_fine: [], not_worth_touching: [], session_hint: null, upgrade_path: null };
const skyline = {
  game: "skylinedrift.exe",
  game_name: "Skyline Drift",
  rough_sessions: 2,
  newest_rough_at: `${new Date().getFullYear()}-11-20T12:00:00Z`,
};
const NOTE = "Separately: Skyline Drift's last 2 measured sessions in a row, up to Nov 20, ran rougher than its usual range.";

const props = {
  hw,
  readiness,
  priorities,
  sessions: [] as SessionSummary[],
  changes: [],
  onRunCheck: () => {},
  onSeeInFix: () => {},
  fixRoomLabel: "Lab",
};

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe.each([
  ["HomeHud", () => <HomeHud {...props} />],
  ["HomeV2", () => <HomeV2 {...props} />],
])("%s: drift + rough game", (_name, face) => {
  it("prints the check's detail and the rough note as two separate elements, never one sentence", async () => {
    engine.status = { rough: [skyline], games_judged: 1, back_in_range: [] };
    const { container } = render(
      <ShellV2 items={railFor(true)} activeId="home" onNavigate={() => {}} ledger={[]}>
        {face()}
      </ShellV2>,
    );
    await settle();
    const note = screen.getByTestId("home-rough-note");
    expect(note.textContent).toBe(NOTE);
    // The detail is on screen, and no single element's own text holds both.
    expect(container.textContent).toContain(DETAIL);
    expect(note.textContent).not.toContain(DETAIL);
    const holder = [...container.querySelectorAll("*")].find(
      (el) => el.childElementCount === 0 && (el.textContent ?? "").includes(DETAIL),
    );
    expect(holder).toBeTruthy();
    expect(holder!.textContent).not.toContain("Skyline Drift");
  });
});
