import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { HomeRoom } from "./HomeRoom";
import { RigViewer } from "./rig/RigViewer";
import { ShellV2 } from "../design/ShellV2";
import { railFor } from "../design/homeRail";
import type { AppliedChange, GameReadiness, Priorities, SessionSummary } from "../types";
import type { HardwareInfo } from "../App";

// bug→guard (self-review catch on T4d `bf76a07`): the hologram bay's auto-orbit default must
// follow !readHologramV2() on EVERY host component. V2 (the shipped default) rests idle — orbit
// is an explicit opt-in so idle GPU stays ~0; classic (flag "0") keeps its always-orbiting look.
// HomeHud carried its own hardcoded-on copy of the control, so a fresh Home auto-orbited
// unattended while the sibling RigViewer honored the contract.

vi.mock("./rig/RigHologram", () => ({
  RigHologram: () => <div data-testid="rig-hologram" />,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    if (cmd === "get_build_stamp") return Promise.resolve("ab12cd3 · dev");
    if (cmd === "get_gpu_sensors") return Promise.resolve([{ temperature_c: 62 }]);
    if (cmd === "get_fan_sensors") return Promise.resolve([]);
    if (cmd === "get_memory_pressure")
      return Promise.resolve({
        used_bytes: 14.2 * 1024 ** 3,
        total_bytes: 29.4 * 1024 ** 3,
        level: "ok",
      });
    return Promise.resolve(null);
  },
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

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

afterEach(() => {
  cleanup();
  localStorage.clear();
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
  limiters: [],
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

const props = {
  hw,
  readiness,
  priorities,
  sessions: [session],
  changes: [change],
  onRunCheck: () => {},
  onSeeInFix: () => {},
};

const shell = (child: React.ReactNode) => (
  <ShellV2
    items={railFor(true)}
    activeId="home"
    onNavigate={() => {}}
    ledgerCount={1}
    version="0.1.0"
  >
    {child}
  </ShellV2>
);

describe("hologram orbit default follows !readHologramV2() on every host (T4d contract)", () => {
  it("HomeHud bay, fresh default (v2 ON): Orbit renders un-pressed — no unattended rotation", async () => {
    const c = render(shell(<HomeRoom {...props} />));
    const orbit = await c.findByRole("button", { name: "Orbit" });
    expect(orbit.getAttribute("aria-pressed")).toBe("false");
    expect(orbit.className).not.toContain("hud-seg-on");
  });

  it("HomeHud bay, classic (flag '0'): auto-orbit stays the default", async () => {
    localStorage.setItem("compy_hologram_v2", "0");
    const c = render(shell(<HomeRoom {...props} />));
    const orbit = await c.findByRole("button", { name: "Orbit" });
    expect(orbit.getAttribute("aria-pressed")).toBe("true");
    expect(orbit.className).toContain("hud-seg-on");
  });

  it("RigViewer bay, fresh default (v2 ON): Orbit renders un-pressed", async () => {
    const c = render(<RigViewer hw={hw} />);
    const orbit = await c.findByRole("button", { name: "Orbit" });
    expect(orbit.getAttribute("aria-pressed")).toBe("false");
    expect(orbit.className).not.toContain("btn-small-on");
  });

  it("RigViewer bay, classic (flag '0'): auto-orbit stays the default", async () => {
    localStorage.setItem("compy_hologram_v2", "0");
    const c = render(<RigViewer hw={hw} />);
    const orbit = await c.findByRole("button", { name: "Orbit" });
    expect(orbit.getAttribute("aria-pressed")).toBe("true");
    expect(orbit.className).toContain("btn-small-on");
  });
});
