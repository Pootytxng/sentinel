import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { HomeRoom } from "./HomeRoom";
import { HomeHud } from "./HomeHud";
import { HomeV2 } from "./HomeV2";
import { ShellV2 } from "../design/ShellV2";
import { railFor } from "../design/homeRail";
import type { AppliedChange, GameReadiness, Priorities, SessionSummary } from "../types";
import type { HardwareInfo } from "../App";

// Guards for the Home console cold-open flag (plan 2026-07-10-console-hud-phase2-home, Task 1;
// DEFAULT-ON flip 2026-07-10 after the owner's eyeball approval, per ship-approved-work-as-
// the-build). compy_home_console is DEFAULT ON: absent or "1", HomeRoom renders the console
// root. Key "0" is the classic failsafe — byte-identical to the pre-console tree for BOTH
// compy_editorial states (the hud default and the "0" classic failsafe).

vi.mock("./rig/RigHologram", () => ({
  RigHologram: () => <div data-testid="rig-hologram" />,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    if (cmd === "get_build_stamp") return Promise.resolve("ab12cd3 · dev");
    if (cmd === "get_gpu_sensors") return Promise.resolve([{ temperature_c: 62 }]);
    if (cmd === "get_memory_pressure")
      return Promise.resolve({
        used_bytes: 14.2 * 1024 ** 3,
        total_bytes: 29.4 * 1024 ** 3,
        level: "ok",
      });
    return Promise.resolve(null);
  },
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
    ledger={[]}
   
  >
    {child}
  </ShellV2>
);

describe("Home console flag '0' — the classic failsafe stays byte-identical (the failsafe contract)", () => {
  // The shell's HUD frame (compy_hud_frame, default ON) mounts a live HH:MM:SS clock — freeze
  // time so the two sequential renders can't tick across a second boundary and break the
  // byte-identical comparison (full-suite flake caught 2026-07-15).
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T12:00:00"));
  });
  afterEach(() => vi.useRealTimers());

  it("hud default (editorial absent): key '0' === direct HomeHud", () => {
    const direct = render(shell(<HomeHud {...props} />)).container.innerHTML;
    cleanup();
    localStorage.setItem("compy_home_console", "0");
    const off = render(shell(<HomeRoom {...props} />)).container.innerHTML;
    expect(off).toBe(direct);
  });

  it("classic failsafe (editorial '0'): key '0' === direct HomeV2", () => {
    const direct = render(shell(<HomeV2 {...props} />)).container.innerHTML;
    cleanup();
    localStorage.setItem("compy_editorial", "0");
    localStorage.setItem("compy_home_console", "0");
    const off = render(shell(<HomeRoom {...props} />)).container.innerHTML;
    expect(off).toBe(direct);
  });
});

describe("Home console DEFAULT ON — the console branch wins (owner-approved flip 2026-07-10)", () => {
  it("key ABSENT (the shipped default) renders the console root and neither of today's Home trees", () => {
    const c = render(shell(<HomeRoom {...props} />)).container;
    expect(c.querySelector(".home-console")).not.toBeNull();
    expect(c.querySelector("[data-hud-home]")).toBeNull();
    expect(c.querySelector(".hv2-grid")).toBeNull();
  });

  it("explicit '1' renders the console too (the pre-flip opt-in carries over)", () => {
    localStorage.setItem("compy_home_console", "1");
    const c = render(shell(<HomeRoom {...props} />)).container;
    expect(c.querySelector(".home-console")).not.toBeNull();
    expect(c.querySelector("[data-hud-home]")).toBeNull();
    expect(c.querySelector(".hv2-grid")).toBeNull();
  });

  it("wins over the editorial '0' failsafe too (highest-priority branch)", () => {
    localStorage.setItem("compy_editorial", "0");
    const c = render(shell(<HomeRoom {...props} />)).container;
    expect(c.querySelector(".home-console")).not.toBeNull();
    expect(c.querySelector(".hv2-grid")).toBeNull();
  });
});
