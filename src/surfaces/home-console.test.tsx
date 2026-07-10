import { describe, it, expect, vi, afterEach, beforeEach, beforeAll } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { ShellV2 } from "../design/ShellV2";
import { railFor } from "../design/homeRail";
import { postureLine } from "./command-center-data";
import { activeChangeCount } from "./dashboard-data";
import { HomeConsole } from "./HomeConsole";
import type { AppliedChange, GameReadiness, Priorities, SessionSummary } from "../types";
import type { HardwareInfo } from "../App";

// HomeConsole — the console cold-open stage (plan 2026-07-10-console-hud-phase2-home, Task 2+).
// Pins the honesty rail (absent readings render ArcGauge's NOT-YET, never a fabricated number;
// measured readings render the real session/check numbers), the real postureLine verdict in the
// masthead, and the header-slop law (no lede/explainer node anywhere in the console header).

// The gauge probes poll on mount; a mutable holder lets tests take the GPU sensor away.
const state = vi.hoisted(() => ({
  gpuSensors: [{ temperature_c: 62 }] as unknown,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    if (cmd === "get_gpu_sensors") return Promise.resolve(state.gpuSensors);
    if (cmd === "get_memory_pressure")
      return Promise.resolve({
        used_bytes: 14.2 * 1024 ** 3,
        total_bytes: 29.4 * 1024 ** 3,
        level: "ok",
      });
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
  it("renders the display verdict as postureLine's real headline, ok LED, real check counts", () => {
    const posture = postureLine(readiness, priorities, activeChangeCount(props.changes));
    const c = mount().container;
    expect(c.querySelector(".v2-verdict h1")!.textContent).toContain(posture.headline);
    expect(c.querySelector(".hc-masthead-eyebrow .hc-led-ok")).not.toBeNull();
    expect(c.querySelector(".hc-led-scan")).toBeNull();
    expect(c.querySelector(".v2-measured")!.textContent).toContain("3/3");
  });

  it("header-slop pin: no lede/explainer node anywhere in the console header", () => {
    const c = mount().container;
    expect(c.querySelector(".home-console-lede")).toBeNull();
    expect(c.querySelector(".hc-lede")).toBeNull();
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
