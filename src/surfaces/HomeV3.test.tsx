import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { HomeV3 } from "./HomeV3";
import type { SessionSummary } from "../types";
import type { HardwareInfo } from "../App";
import type { PostureLine } from "./command-center-data";

// HomeV3 (P3 answer-first Home) — asserts the answer-first contract renders
// honestly: the verdict leads, the limiter slot mounts as passed, the 3 tiles show REAL session
// numbers or the honest empty state (never fabricated), and the full hardware cards are one tap away
// (Cards view — the 3D hologram is the runtime default but is WebGL/lazy, so tests pin Cards).

const hw: HardwareInfo = {
  cpu_brand: "Test CPU",
  cpu_cores_logical: 16,
  cpu_cores_physical: 8,
  cpu_frequency_mhz: 5100,
  ram_total_bytes: 32 * 1024 ** 3,
  ram_used_bytes: 12 * 1024 ** 3,
  swap_total_bytes: 0,
  os_name: "Windows",
  os_version: "11",
  kernel_version: "10.0.26200",
  hostname: "test-rig",
  disks: [],
  gpus: [
    {
      name: "AMD Radeon RX 9070 XT",
      vram_bytes: 16 * 1024 ** 3,
      driver_version: "1.0",
      driver_date: "2026-05-12",
      driver_age_days: 20,
      video_processor: "Test",
      current_refresh_rate_hz: 144,
    },
  ],
  physical_disks: [],
  disk_health: [],
  bios_info: null,
  virtualization: null,
  usb: null,
  display: null,
  memory_modules: [],
  windows_version: {
    edition: "Pro",
    display_version: "25H2",
    build: "26200",
    ubr: 1,
    product_name: "Windows 11 Pro",
  },
  cpu_arch: { vendor: "AMD", family_label: "Ryzen 7", architecture: "Zen", generation: "Zen 5" },
  network_adapters: [],
  has_wired_ethernet_port: true,
};

const session: SessionSummary = {
  started_at: "2026-07-01T20:00:00Z",
  duration_secs: 3600,
  process_name: "valorant.exe",
  samples: 3600,
  avg_fps: 240,
  avg_frametime_ms: 4.2,
  low1_fps_est: 180,
  peak_gpu_temp_c: 71,
  peak_gpu_usage_pct: 97,
  peak_ram_used_bytes: null,
  ram_total_bytes: null,
  compy_changes_active: 1,
  hw_fingerprint: null,
  stutter_insight: null,
};

const posture: PostureLine = {
  headline: "You're ready to play",
  sentence: "Ready to play — 1 worth fixing.",
  reassurance: "Nothing changes without your say-so.",
  tone: "ready",
};

beforeEach(() => {
  localStorage.clear();
  // Pin the Cards rig view: the 3D hologram (runtime default) is lazy WebGL — not a jsdom citizen.
  localStorage.setItem("compy_home_rig_3d", "0");
});

describe("HomeV3 — answer-first Home", () => {
  it("leads with the verdict and mounts the limiter slot unchanged", () => {
    render(
      <HomeV3
        hw={hw}
        sessions={[]}
        posture={posture}
        limiterSlot={<div data-testid="limiter-slot">limiter</div>}
      />,
    );
    expect(screen.getByText("You're ready to play")).toBeTruthy();
    expect(screen.getByText(/1 worth fixing/)).toBeTruthy();
    expect(screen.getByTestId("limiter-slot")).toBeTruthy();
  });

  it("shows the honest empty state when no session exists — no fabricated numbers", () => {
    render(<HomeV3 hw={hw} sessions={[]} posture={posture} limiterSlot={null} />);
    expect(screen.getByText(/Play a session to see this/)).toBeTruthy();
    expect(screen.queryByText("Full debrief →")).toBeNull();
  });

  it("renders the 3 glanceable tiles from REAL session data with a debrief door", () => {
    const onNavigate = vi.fn();
    render(
      <HomeV3 hw={hw} sessions={[session]} posture={posture} limiterSlot={null} onNavigate={onNavigate} />,
    );
    expect(screen.getByText("240")).toBeTruthy(); // avg FPS
    expect(screen.getByText("180")).toBeTruthy(); // 1% low (est)
    expect(screen.getByText("71°C")).toBeTruthy(); // peak GPU temp
    screen.getByText("Full debrief →").click();
    expect(onNavigate).toHaveBeenCalledWith("Play");
  });

  it("keeps the full hardware cards one tap away (Cards view renders the grid)", () => {
    render(<HomeV3 hw={hw} sessions={[]} posture={posture} limiterSlot={null} />);
    // Cards pinned via localStorage → the detailed HardwareGrid is on screen.
    expect(screen.getByText("AMD Radeon RX 9070 XT")).toBeTruthy();
    // The rig-view toggle offers both faces.
    expect(screen.getByRole("tab", { name: "3D" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Cards" })).toBeTruthy();
  });
});
