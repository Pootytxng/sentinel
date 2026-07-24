import { describe, it, expect, vi, afterEach, beforeEach, beforeAll } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { ShellV2 } from "../design/ShellV2";
import { railFor } from "../design/homeRail";
import { postureLine } from "./command-center-data";
import { activeChangeCount } from "./dashboard-data";
import { HomeConsole } from "./HomeConsole";
// i18n update (2026-07-23): postureLine now takes a TFunction as its last param — the real
// i18next instance (English default, same as every assertion below already expects).
import i18n from "../i18n";
import type { AppliedChange, GameReadiness, Priorities, SessionSummary } from "../types";
import type { HardwareInfo } from "../App";
import { readFileSync } from "fs";
import { join } from "path";

// HomeConsole — the console cold-open stage (plan 2026-07-10-console-hud-phase2-home, Task 2+).
// Pins the honesty rail (absent readings render ArcGauge's NOT-YET, never a fabricated number;
// measured readings render the real session/check numbers), the real postureLine verdict in the
// masthead, and the header-slop law (no lede/explainer node anywhere in the console header).

// The gauge probes poll on mount; a mutable holder lets tests take the GPU sensor away.
// headline feeds get_intelligence_headline (Intelligence Phase 1's Home line — null = the
// engine reached no improved/regressed verdict, the honest default); calls records every
// invoke so the flag-off pin can assert the IPC was never made.
const state = vi.hoisted(() => ({
  gpuSensors: [{ temperature_c: 62 }] as unknown,
  headline: null as unknown,
  calls: [] as string[],
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    state.calls.push(cmd);
    if (cmd === "get_gpu_sensors") return Promise.resolve(state.gpuSensors);
    if (cmd === "get_memory_pressure")
      return Promise.resolve({
        used_bytes: 14.2 * 1024 ** 3,
        total_bytes: 29.4 * 1024 ** 3,
        level: "ok",
      });
    if (cmd === "get_intelligence_headline") return Promise.resolve(state.headline);
    return Promise.resolve(null);
  },
}));

// Reduced motion simplifies gauge assertions (useCountTo snaps instead of tweening).
vi.mock("../design/use-motion", () => ({ useReducedMotion: () => true }));

// RigHologram pulls in the ~600KB three.js bundle lazily — stub it so this stays a DOM test.
vi.mock("./rig/RigHologram", () => ({
  RigHologram: () => <div data-testid="rig-hologram" />,
}));

beforeAll(() => {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  class IO {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (globalThis as Record<string, unknown>).ResizeObserver ??= RO;
  (globalThis as Record<string, unknown>).IntersectionObserver ??= IO;
});

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  state.gpuSensors = [{ temperature_c: 62 }];
  state.headline = null;
  state.calls = [];
});

const hw = {
  cpu_brand: "AMD Ryzen 7 9850X3D",
  cpu_arch: { family_label: "Ryzen 7 9850X3D", architecture: "Zen 5", generation: "9000" },
  cpu_cores_logical: 16,
  cpu_cores_physical: 8,
  cpu_frequency_mhz: 5100,
  ram_total_bytes: 32 * 1024 ** 3,
  ram_used_bytes: 16 * 1024 ** 3,
  gpus: [{ name: "AMD Radeon RX 9070 XT", vram_bytes: 16 * 1024 ** 3 }],
  disks: [
    {
      mount_point: "C:\\",
      total_bytes: 1000 * 1024 ** 3,
      available_bytes: 130 * 1024 ** 3,
      file_system: "NTFS",
    },
  ],
  memory_modules: [],
  physical_disks: [],
  display: { current_refresh_rate_hz: 165 },
  os_name: "Windows",
  os_version: "11",
} as unknown as HardwareInfo;

const readiness: GameReadiness = {
  checks: [
    { id: "a", label: "A", status: "ready", detail: "", value: null },
    { id: "b", label: "B", status: "ready", detail: "", value: null },
    { id: "c", label: "C", status: "ready", detail: "", value: null },
  ],
  ready_count: 3,
  attention_count: 0,
  unknown_count: 0,
  advisory_count: 0,
  advisory: "",
  dismissed_ids: [],
  drifts: [],
};

const priorities: Priorities = {
  limiters: [
    {
      id: "disk",
      title: "C: drive is 87% full",
      reason: "Below ~10% free, load times suffer.",
      linked: null,
      confidence: "high",
      status: "attention",
    },
  ],
  already_fine: [],
  not_worth_touching: [],
  session_hint: null,
  upgrade_path: null,
};

const session = {
  started_at: "2026-07-01T18:00:00Z",
  duration_secs: 3600,
  process_name: "cyberpunk2077.exe",
  samples: 1000,
  avg_fps: 142.3,
  avg_frametime_ms: 7,
  low1_fps_est: 98.4,
  peak_gpu_temp_c: 71,
  peak_gpu_usage_pct: 97,
  peak_ram_used_bytes: null,
  ram_total_bytes: null,
  compy_changes_active: 1,
} as SessionSummary;

const change = {
  id: "ch1",
  rec_id: "hags-enable",
  rec_title: "Hardware-accelerated GPU scheduling",
  applied_at: "2026-06-28T18:22:00Z",
  snapshot: null,
  status: "applied",
  is_still_active: true,
} as unknown as AppliedChange;

const props: {
  hw: HardwareInfo;
  readiness: GameReadiness | null;
  priorities: Priorities | null;
  sessions: SessionSummary[];
  changes: AppliedChange[];
  onRunCheck: () => void;
  onSeeInFix: () => void;
  fixRoomLabel?: string;
  onNavigate?: (key: string) => void;
  rooms?: { key: string; name: string }[];
} = {
  hw,
  readiness,
  priorities,
  sessions: [session],
  changes: [change],
  onRunCheck: () => {},
  onSeeInFix: () => {},
};

const mount = (p = props) =>
  render(
    <ShellV2
      items={railFor(true)}
      activeId="home"
      onNavigate={() => {}}
      ledgerCount={1}
      version="0.1.0"
    >
      <HomeConsole {...p} />
    </ShellV2>,
  );

describe("HomeConsole — masthead (the proven HomeHud register)", () => {
  it("title-header law: the h1 is the room TITLE; the posture verdict renders ONCE, in body context", () => {
    const posture = postureLine(readiness, priorities, activeChangeCount(props.changes), i18n.t);
    const c = mount().container;
    const h1 = c.querySelector(".v2-verdict h1")!;
    expect(h1.querySelector(".hc-headline")!.textContent).toBe("Home");
    expect(h1.textContent).not.toContain(posture.headline);
    // The relocated verdict: postureLine's real output, exactly once (one-mention law),
    // inside the room body — never a second copy anywhere on the screen.
    const lines = Array.from(c.querySelectorAll(".hc-verdict-line"));
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toBe(posture.headline);
    expect(lines[0].closest(".home-console")).not.toBeNull();
    expect(c.querySelector(".hc-masthead-eyebrow .hc-led-ok")).not.toBeNull();
    expect(c.querySelector(".hc-led-scan")).toBeNull();
    expect(c.querySelector(".v2-measured")!.textContent).toContain("3/3");
  });

  it("attention state: verdict strip carries the warn tone class + the real headline", () => {
    const attn: GameReadiness = {
      ...readiness,
      checks: [
        { id: "a", label: "Refresh rate", status: "attention", detail: "", value: null },
        { id: "b", label: "B", status: "ready", detail: "", value: null },
        { id: "c", label: "C", status: "ready", detail: "", value: null },
      ],
      ready_count: 2,
      attention_count: 1,
    };
    const posture = postureLine(attn, priorities, activeChangeCount(props.changes), i18n.t);
    const c = mount({ ...props, readiness: attn }).container;
    expect(posture.tone).toBe("attention");
    const strip = c.querySelector(".hc-verdict")!;
    expect(strip.className).toContain("hc-verdict-attention");
    expect(strip.querySelector(".hc-verdict-line")!.textContent).toBe(posture.headline);
    expect(c.querySelector(".v2-verdict h1")!.textContent).not.toContain(posture.headline);
  });

  it("header-slop pin: no lede/explainer node anywhere in the console header, and no sub line", () => {
    const c = mount().container;
    expect(c.querySelector(".home-console-lede")).toBeNull();
    expect(c.querySelector(".hc-lede")).toBeNull();
    // The dek moved to body context with the verdict — the header keeps no descriptive line.
    expect(c.querySelector(".v2-verdict-sub")).toBeNull();
  });
});

describe("HomeConsole — the console stage (hologram center + honest corner gauges)", () => {
  it("renders the recognizable rig hologram at center-stage", async () => {
    mount();
    const rig = await screen.findByTestId("rig-hologram");
    expect(rig.closest(".hc-stage")).not.toBeNull();
  });

  it("honest NOT-YET: no sessions + no GPU reading → FPS/1%-low/GPU gauges carry the tag, no numbers", () => {
    state.gpuSensors = null;
    const c = mount({ ...props, sessions: [] }).container;
    for (const corner of [".hc-tr", ".hc-bl", ".hc-br"]) {
      const el = c.querySelector(corner)!;
      expect(el.querySelector(".ag-tag-ny"), `${corner} NOT-YET tag`).not.toBeNull();
      expect(el.querySelector(".ag-v")!.textContent, `${corner} readout`).toBe("— —");
    }
  });

  it("measured session → Avg FPS and 1% low render the real numbers", () => {
    const c = mount().container;
    expect(c.querySelector(".hc-tr .ag-v")!.textContent).toBe("142");
    expect(c.querySelector(".hc-tr .ag-tag-ny")).toBeNull();
    expect(c.querySelector(".hc-bl .ag-v")!.textContent).toBe("98");
    expect(c.querySelector(".hc-bl .ag-tag-ny")).toBeNull();
  });

  it("Readiness = the real ready/total ratio; NOT-YET while checks are running", () => {
    const c = mount().container;
    expect(c.querySelector(".hc-tl .ag-v")!.textContent).toBe("100");
    cleanup();
    const checking = mount({ ...props, readiness: null, priorities: null }).container;
    expect(checking.querySelector(".hc-tl .ag-tag-ny")).not.toBeNull();
    expect(checking.querySelector(".v2-measured")!.textContent).toContain("running checks…");
  });

  it("GPU temp gauge shows the polled reading once it lands", async () => {
    const c = mount().container;
    await waitFor(() => expect(c.querySelector(".hc-br .ag-v")!.textContent).toBe("62"));
    expect(c.querySelector(".hc-br .ag-tag-ny")).toBeNull();
  });
});

// The ground rail's rooms minus home itself — what App threads at default-ON (Task 3).
const groundRooms = [
  { key: "play", name: "Monitor" },
  { key: "learn", name: "Blackbook" },
  { key: "lab", name: "Lab" },
];

// The ShellV2 rail renders buttons with the same room names, so every dock assertion scopes
// to the .dock subtree (the console's doors, not the app rail).
const dockNode = (c: HTMLElement, name: string): HTMLElement | null => {
  const nodes = Array.from(c.querySelectorAll<HTMLElement>(".dock .dock-node"));
  return nodes.find((n) => n.querySelector(".dock-nm")?.textContent === name) ?? null;
};

describe("HomeConsole — the Dock into the rooms (navigation, honest doors)", () => {
  it("renders one dock door per passed room and clicking fires onNavigate with that key", () => {
    const nav = vi.fn();
    const c = mount({ ...props, rooms: groundRooms, onNavigate: nav }).container;
    expect(c.querySelectorAll(".dock .dock-node")).toHaveLength(3);
    fireEvent.click(dockNode(c, "Monitor")!);
    expect(nav).toHaveBeenCalledWith("play");
    fireEvent.click(dockNode(c, "Blackbook")!);
    expect(nav).toHaveBeenCalledWith("learn");
  });

  it("no door for a room not in the list; no rooms → no dock at all (honest doors)", () => {
    const c = mount({
      ...props,
      rooms: [{ key: "play", name: "Monitor" }],
      onNavigate: () => {},
    }).container;
    expect(dockNode(c, "Monitor")).not.toBeNull();
    expect(dockNode(c, "Blackbook")).toBeNull();
    cleanup();
    const bare = mount().container;
    expect(bare.querySelector(".dock")).toBeNull();
  });

  it("the guided-action room glows primary: 'fix' when the rail has one, else the Lab (ground)", () => {
    const c = mount({ ...props, rooms: groundRooms, onNavigate: () => {} }).container;
    expect(dockNode(c, "Lab")!.className).toContain("dock-node-primary");
    expect(dockNode(c, "Monitor")!.className).not.toContain("dock-node-primary");
    cleanup();
    const classic = mount({
      ...props,
      rooms: [
        { key: "fix", name: "Optimize" },
        ...groundRooms.filter((r) => r.key !== "lab"),
      ],
      onNavigate: () => {},
    }).container;
    expect(dockNode(classic, "Optimize")!.className).toContain("dock-node-primary");
  });

  it("Home never marks a room active (activeKey stays null)", () => {
    const c = mount({ ...props, rooms: groundRooms, onNavigate: () => {} }).container;
    expect(c.querySelector(".dock-node-active")).toBeNull();
  });

  it("ONE forward affordance: the dock suppresses RoomShell's ForwardDoor; no dock → door stays (bug→guard, self-reviewer 2026-07-10)", () => {
    // With the dock rendered, RoomShell's own "Find what's worth fixing → Lab" door would be a
    // second go-to-Lab control stacked right under the Lab dock node — the duplication catch.
    const c = mount({ ...props, rooms: groundRooms, onNavigate: () => {} }).container;
    expect(c.querySelector(".dock")).not.toBeNull();
    expect(c.querySelector(".v2-door")).toBeNull();
    cleanup();
    const bare = mount().container;
    expect(bare.querySelector(".dock")).toBeNull();
    expect(bare.querySelector(".v2-door")).not.toBeNull();
  });
});

describe("HomeConsole — motion contract (Task 4)", () => {
  it("reduced motion → the console root carries data-motion='reduced' (still page)", () => {
    // use-motion is mocked reduced=true for this whole file — the still-page branch.
    const c = mount().container;
    expect(c.querySelector(".home-console")!.getAttribute("data-motion")).toBe("reduced");
    // The reticle Target Cursor renders nothing under reduced motion (kit contract).
    expect(c.querySelector(".lc-reticle")).toBeNull();
  });

  it("never paints the vendor MagicBento purple — the console is token-only", () => {
    const c = mount({ ...props, rooms: groundRooms, onNavigate: () => {} }).container;
    expect(c.innerHTML).not.toMatch(/132\s*,\s*0\s*,\s*255/);
  });
});

// B6a (owner direction 2026-07-14): the hologram is the INDEX into the dense data — callouts
// with a dense record expand on demand into the full detected readout. Same HardwareInfo the
// Cards view renders; a missing field omits its row (never a placeholder).
const denseHw = {
  ...hw,
  gpus: [
    {
      name: "AMD Radeon RX 9070 XT",
      vram_bytes: 16 * 1024 ** 3,
      driver_version: "25.5.1",
      driver_date: "2026-05-02",
    },
  ],
  memory_modules: [
    {
      capacity_bytes: 16 * 1024 ** 3,
      speed_mhz: 6000,
      rated_speed_mhz: 6000,
      type_name: "DDR5",
      manufacturer: "Corsair",
      xmp_expo_status: "running_at_rated",
    },
    {
      capacity_bytes: 16 * 1024 ** 3,
      speed_mhz: 6000,
      rated_speed_mhz: 6000,
      type_name: "DDR5",
      manufacturer: "Corsair",
      xmp_expo_status: "running_at_rated",
    },
  ],
} as unknown as HardwareInfo;

describe("HomeConsole — callout dense readouts (B6a: the hologram indexes the dense data)", () => {
  const gpuButton = (c: HTMLElement) =>
    Array.from(c.querySelectorAll<HTMLButtonElement>(".hc-callout-btn")).find((b) =>
      b.textContent?.includes("GPU"),
    )!;

  it("default face is unchanged: no dense readout in the DOM, expandable callouts closed", () => {
    const c = mount({ ...props, hw: denseHw }).container;
    expect(c.querySelector(".hc-callout-dense")).toBeNull();
    expect(gpuButton(c).getAttribute("aria-expanded")).toBe("false");
  });

  it("click expands into the DETECTED record (driver, VRAM) and click again collapses", () => {
    const c = mount({ ...props, hw: denseHw }).container;
    fireEvent.click(gpuButton(c));
    expect(gpuButton(c).getAttribute("aria-expanded")).toBe("true");
    const dense = gpuButton(c).closest(".hc-callout")!.querySelector(".hc-callout-dense")!;
    expect(dense.textContent).toContain("AMD Radeon RX 9070 XT");
    expect(dense.textContent).toContain("16 GB");
    expect(dense.textContent).toContain("25.5.1");
    fireEvent.click(gpuButton(c));
    expect(c.querySelector(".hc-callout-dense")).toBeNull();
  });

  it("RAM expands to per-module detected rows (capacity · type · speed · manufacturer)", () => {
    const c = mount({ ...props, hw: denseHw }).container;
    const ramBtn = Array.from(c.querySelectorAll<HTMLButtonElement>(".hc-callout-btn")).find(
      (b) => b.textContent?.includes("RAM"),
    )!;
    fireEvent.click(ramBtn);
    const dense = ramBtn.closest(".hc-callout")!.querySelector(".hc-callout-dense")!;
    expect(dense.textContent).toContain("slot 1");
    expect(dense.textContent).toContain("16 GB · DDR5 · 6000 MT/s · Corsair");
    expect(dense.querySelectorAll(".hc-dense-row")).toHaveLength(2);
  });

  it("honesty: a missing field omits its ROW; an empty record renders NO button at all", () => {
    // Default fixture: gpus[0] has no driver fields → no driver row, no fabricated value.
    const c = mount().container;
    fireEvent.click(gpuButton(c));
    const dense = gpuButton(c).closest(".hc-callout")!.querySelector(".hc-callout-dense")!;
    expect(dense.textContent).not.toContain("driver");
    // memory_modules is empty in the default fixture → the RAM callout is not expandable.
    const ramBtn = Array.from(c.querySelectorAll<HTMLButtonElement>(".hc-callout-btn")).find(
      (b) => b.textContent?.includes("RAM"),
    );
    expect(ramBtn).toBeUndefined();
  });
});

describe("HomeConsole — the #1-limiter readout (measured fact + its fix route)", () => {
  it("renders the top limiter's real title, quiet confidence tag, and the jump control", () => {
    const jump = vi.fn();
    const c = mount({ ...props, onSeeInFix: jump, fixRoomLabel: "Lab" }).container;
    const row = c.querySelector(".hc-limiter")!;
    expect(row).not.toBeNull();
    expect(row.textContent).toContain("C: drive is 87% full");
    expect(row.querySelector(".hc-limiter-tag")!.textContent).toContain("high confidence");
    fireEvent.click(row.querySelector("button")!);
    expect(jump).toHaveBeenCalled();
  });

  it("renders NOTHING when limiters are empty or priorities are still loading (no placeholder)", () => {
    const clean = mount({
      ...props,
      priorities: { ...(priorities as Priorities), limiters: [] },
    }).container;
    expect(clean.querySelector(".hc-limiter")).toBeNull();
    cleanup();
    const loading = mount({ ...props, priorities: null }).container;
    expect(loading.querySelector(".hc-limiter")).toBeNull();
  });
});

// bug→guard (self-review 2026-07-17): the fix that made the attention verdict NAME the top
// flagged check introduced a DUPLICATION — when that same item is ALSO the #1 limiter, its title
// rendered twice on Home (the gold verdict headline + the "top limiter" row ~500px below). The
// limiter row must stand down and let the verdict own the story (one-owner-per-screen, P5 voice).
const topLimiterRows = (c: HTMLElement) =>
  Array.from(c.querySelectorAll(".hc-limiter")).filter(
    (r) => r.querySelector(".hc-limiter-label")?.textContent === "top limiter",
  );

describe("HomeConsole — verdict/top-limiter one-owner dedup", () => {
  it("the top-limiter row stands down when the verdict headline already names it (no double string)", () => {
    // The sole attention check has the SAME title as the sole limiter (the live-machine collision).
    const attn: GameReadiness = {
      ...readiness,
      checks: [
        { id: "disk", label: "C: drive is 87% full", status: "attention", detail: "Free up space.", value: null },
        { id: "b", label: "B", status: "ready", detail: "", value: null },
      ],
      ready_count: 1,
      attention_count: 1,
    };
    const c = mount({ ...props, readiness: attn }).container;
    // The verdict owns the story…
    expect(c.querySelector(".hc-verdict-line")!.textContent).toBe("C: drive is 87% full");
    // …and the "top limiter" row does not restate it.
    expect(topLimiterRows(c)).toHaveLength(0);
    // The exact title appears exactly once across the whole console (the regression was twice).
    expect((c.textContent!.match(/C: drive is 87% full/g) ?? []).length).toBe(1);
  });

  it("a DIFFERENT flagged check does not suppress an unrelated top limiter (no false standdown)", () => {
    const attn: GameReadiness = {
      ...readiness,
      checks: [
        { id: "ref", label: "Refresh rate below max", status: "attention", detail: "Bump it.", value: null },
        { id: "b", label: "B", status: "ready", detail: "", value: null },
      ],
      ready_count: 1,
      attention_count: 1,
    };
    const c = mount({ ...props, readiness: attn }).container;
    expect(c.querySelector(".hc-verdict-line")!.textContent).toBe("Refresh rate below max");
    const row = topLimiterRows(c)[0];
    expect(row).not.toBeUndefined();
    expect(row.textContent).toContain("C: drive is 87% full");
  });
});

// Intelligence Phase 1, decision 7: Home carries at most ONE concise line — the engine's own
// verdict sentence verbatim (get_intelligence_headline is non-null ONLY for a real
// improved/regressed verdict, engine-enforced). Flag "0" must render nothing AND never fetch.
const headlineFixture = {
  text: "1% lows improved 10.1% vs your previous Valorant session. Most likely: GPU driver updated (medium confidence).",
  verdict: "improved",
  game: "Valorant",
  session_started_at: "2026-07-10T20:00:00Z",
};

// Two rows share .hc-limiter (deliberate class reuse) — the micro-label tells them apart.
const intelRow = (c: HTMLElement): HTMLElement | null =>
  Array.from(c.querySelectorAll<HTMLElement>(".hc-limiter")).find(
    (r) => r.querySelector(".hc-limiter-label")?.textContent === "last session",
  ) ?? null;

describe("HomeConsole — the last-session intelligence line (Intelligence Phase 1)", () => {
  it("renders the engine's headline verbatim with the door into Monitor (rooms has play)", async () => {
    state.headline = headlineFixture;
    const nav = vi.fn();
    const c = mount({ ...props, rooms: groundRooms, onNavigate: nav }).container;
    await waitFor(() => expect(intelRow(c)).not.toBeNull());
    const row = intelRow(c)!;
    expect(row.querySelector(".hc-limiter-title")!.textContent).toBe(headlineFixture.text);
    // The headline sentence already names the game — the row adds no second game tag.
    expect(row.querySelectorAll(".hc-limiter-tag")).toHaveLength(0);
    const door = row.querySelector("button")!;
    expect(door.textContent).toBe("See in Monitor");
    fireEvent.click(door);
    expect(nav).toHaveBeenCalledWith("play");
    // The limiter row is untouched beside it — two rows, each with its own label.
    expect(c.querySelectorAll(".hc-limiter")).toHaveLength(2);
  });

  it("honest door: no Monitor on the rail ⇒ the line renders without a dead-end button", async () => {
    state.headline = headlineFixture;
    const c = mount({
      ...props,
      rooms: [{ key: "lab", name: "Lab" }],
      onNavigate: () => {},
    }).container;
    await waitFor(() => expect(intelRow(c)).not.toBeNull());
    expect(intelRow(c)!.querySelector("button")).toBeNull();
  });

  it("no verdict ⇒ no line: a null headline renders nothing (never a fabricated sentence)", async () => {
    state.headline = null;
    const c = mount({ ...props, rooms: groundRooms, onNavigate: () => {} }).container;
    await waitFor(() => expect(state.calls).toContain("get_intelligence_headline"));
    expect(intelRow(c)).toBeNull();
  });

  it('compy_intelligence "0" failsafe: no line AND the IPC is never invoked', async () => {
    localStorage.setItem("compy_intelligence", "0");
    state.headline = headlineFixture; // even a ready headline must not leak through
    const c = mount({ ...props, rooms: groundRooms, onNavigate: () => {} }).container;
    await new Promise((r) => setTimeout(r, 0));
    expect(intelRow(c)).toBeNull();
    expect(state.calls).not.toContain("get_intelligence_headline");
  });
});

// bug→guard (self-reviewer 2026-07-18, flagged intermittently while reviewing §4H in 2D):
// the four .hc-corner ArcGauges are ALWAYS present (z-index:2, pinned 22px from each stage edge,
// ~56px tall) regardless of rig view mode. In 2D card mode (compy_home_rig_3d="0") .hc-stage-cards
// renders the full HardwareGrid; a full-height viewport (was max-height:420px) let a tall grid
// scroll its rows UNDER the top/bottom gauges — padding can't help a scroll container mid-scroll.
// The fix confines .hc-stage-cards to the gauge-free MIDDLE band via a bounded max-height. jsdom
// has no layout engine, so the mechanized guard is (1) a DOM check that the 2D card path and all
// four corner gauges coexist in one stage (the collision precondition), and (2) a CSS-contract
// bound proving the viewport can never span the full stage again.
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const block = (css: string, selector: string) => {
  const m = stripComments(css).match(
    new RegExp(`${selector.replace(/[.[\]"=]/g, "\\$&")}\\s*\\{([^}]*)\\}`),
  );
  if (!m) throw new Error(`selector ${selector} not found`);
  return m[1];
};

describe("HomeConsole — 2D card viewport clears the always-present corner gauges (bug→guard)", () => {
  it("2D mode: the card path and all four corner gauges coexist in one stage (collision precondition)", () => {
    localStorage.setItem("compy_home_rig_3d", "0");
    const stage = mount().container.querySelector(".hc-stage")!;
    // The 2D fallback renders the real HardwareGrid, not the 3D hologram…
    expect(stage.querySelector(".hc-stage-cards .grid")).not.toBeNull();
    expect(stage.querySelector('[data-testid="rig-hologram"]')).toBeNull();
    // …while all four corner gauges are still pinned in the same stage box (they overlap the cards).
    for (const corner of [".hc-tl", ".hc-tr", ".hc-bl", ".hc-br"]) {
      expect(stage.querySelector(corner), `${corner} gauge present`).not.toBeNull();
    }
  });

  it("CSS: .hc-stage-cards is a scroll viewport confined to the gauge-free band (never full-stage)", () => {
    const css = readFileSync(join("src", "surfaces", "home-console.css"), "utf8");
    const cards = block(css, ':root[data-v2="on"] .hc-stage-cards');
    expect(cards).toMatch(/overflow-y:\s*auto/); // a scroll viewport (clips, then scrolls), not clip
    const m = cards.match(/max-height:\s*(\d+)px/);
    expect(m, "max-height must be an explicit px bound").not.toBeNull();
    const maxH = Number(m![1]);
    // DERIVED bound (2026-07-23, stage grew 420→540 for tester J's bigger-hologram ask): read the
    // stage's own min-height so the two values can never drift apart again. Stage content =
    // minH − 2·28 padding; each corner gauge intrudes ~(22 inset + 56 tall − 28 padding) = 50px
    // from the top AND the bottom, so the gauge-free band is (minH − 56) − 100. The regression
    // this guards was a full-stage viewport scrolling rows UNDER the gauges.
    const stage = block(css, ':root[data-v2="on"] .hc-stage');
    const minM = stage.match(/min-height:\s*(\d+)px/);
    expect(minM, ".hc-stage must declare an explicit min-height").not.toBeNull();
    const band = Number(minM![1]) - 56 - 100;
    expect(maxH).toBeLessThanOrEqual(band);
    expect(maxH).toBeGreaterThan(0);
  });
});
