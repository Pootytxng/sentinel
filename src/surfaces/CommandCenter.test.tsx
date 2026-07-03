import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import CommandCenter from "./CommandCenter";
import type { SessionSummary } from "../types";
import type { HardwareInfo } from "../App";

// Minimal props — readiness/priorities null (shimmer/scanning states), no sessions (honest empty
// live strip), no linked limiter rec. Asserts the surface MOUNTS without throwing and shows honest
// pre-data states rather than fabricated numbers. (AmbientBackdrop's invoke/getContext are absent
// under jsdom but it fails soft, so the surface still renders.) The Home now renders the shared
// HardwareGrid, so `hw` is a full HardwareInfo (empty arrays where the grid only maps).
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
      name: "Test GPU",
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

const baseProps = {
  hw,
  readiness: null,
  priorities: null,
  sessions: [] as SessionSummary[],
  changes: [],
  limiterRec: undefined,
  limiterAppliable: false,
  limiterActiveChange: null,
  busyLimiter: false,
  onToggleLimiter: vi.fn(),
  onSeeInFix: vi.fn(),
  onNavigate: vi.fn(),
  onRunCheck: vi.fn(),
  onBack: vi.fn(),
  canGoBack: false,
  onForward: vi.fn(),
  canGoForward: false,
};

describe("CommandCenter", () => {
  beforeEach(() => {
    localStorage.setItem("compy_home_rig_3d", "0"); // Cards view — the 3D hologram isn't a jsdom citizen
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("mounts the answer-first Home with honest pre-data states (no fabricated numbers)", () => {
    render(<CommandCenter {...baseProps} />);
    expect(screen.getByText(/Good (morning|afternoon|evening)/)).toBeTruthy();
    // Verdict leads (honest scanning posture — readiness is null); limiter card + honest empty
    // tiles follow. No invented score anywhere.
    expect(screen.getByText("Scanning your system…")).toBeTruthy();
    expect(screen.getByText("Your #1 limiter")).toBeTruthy();
    expect(screen.getByText(/Play a session to see this/)).toBeTruthy();
    // Rig line carries real hardware.
    expect(screen.getByText(/16 threads/)).toBeTruthy();
  });

  it("renders the win state when priorities resolve with no limiters", () => {
    render(
      <CommandCenter
        {...baseProps}
        priorities={{ limiters: [], already_fine: [], not_worth_touching: [], session_hint: null, upgrade_path: null }}
      />,
    );
    expect(screen.getByText(/None found today/)).toBeTruthy();
  });

  // bug→guard (owner taste catch, P5 2026-07-02): on the answer-first Home the posture verdict and
  // the limiter card BOTH said "measured clean" — the same win announced twice, one panel apart.
  // The verdict owns that phrase; every other panel finds different words. Guard the whole surface.
  it("says 'measured clean' at most once on the clean Home", () => {
    render(
      <CommandCenter
        {...baseProps}
        readiness={{
          checks: [{ id: "ssd", label: "SSD", status: "ready", detail: "", value: null }],
          ready_count: 1,
          advisory_count: 0,
          attention_count: 0,
          unknown_count: 0,
          advisory: "",
          dismissed_ids: [],
          drifts: [],
        }}
        priorities={{ limiters: [], already_fine: [], not_worth_touching: [], session_hint: null, upgrade_path: null }}
      />,
    );
    const hits = screen.queryAllByText(/measured clean/i);
    expect(hits.length).toBeLessThanOrEqual(1);
  });
});
