import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup, screen } from "@testing-library/react";
import { MonitorDomainCards } from "./MonitorDomainCards";
import type { CpuSensorSnapshot, GpuSensorSnapshot, MemoryPressure } from "./monitor-panels";

// T3+T4b pins (spec 2026-07-06-firstcheck-monitor-mvp-train): collapsed card count, expanded
// state shows ALL the classic rows (summary-first, never summary-only, ≤1 click), the
// kernel-driver CPU-temp explainer renders once (expanded CPU only), reduced-motion path
// renders plain numbers (no sliding reels).

afterEach(cleanup);

const cpuSnap = (usage: number): CpuSensorSnapshot => ({
  usage_overall_pct: usage,
  usage_per_core_pct: Array.from({ length: 16 }, () => usage),
  frequency_mhz: 5100,
  ram_used_bytes: 12 * 1024 ** 3,
  ram_total_bytes: 32 * 1024 ** 3,
});

const gpuSnap: GpuSensorSnapshot = {
  vendor: "AMD",
  index: 0,
  name: "Radeon RX 9070 XT",
  temperature_c: 62,
  hotspot_temperature_c: 78,
  utilization_gpu_pct: 41,
  utilization_memory_pct: null,
  vram_used_bytes: 6 * 1024 ** 3,
  vram_total_bytes: 16 * 1024 ** 3,
  graphics_clock_mhz: 2450,
  memory_clock_mhz: 1250,
  power_draw_w: 180,
  fan_speed_pct: null,
  fan_speed_rpm: 1200,
};

const mem: MemoryPressure = {
  used_bytes: 12 * 1024 ** 3,
  total_bytes: 32 * 1024 ** 3,
  used_pct: 38,
  swap_used_bytes: 1 * 1024 ** 3,
  swap_total_bytes: 8 * 1024 ** 3,
  level: "ok",
  advisory: null,
  top_consumers: [{ name: "chrome.exe", bytes: 3 * 1024 ** 3 }],
};

const mount = (reduced = false) =>
  render(
    <MonitorDomainCards
      cpuSamples={[cpuSnap(30), cpuSnap(35)]}
      gpuSamples={[[gpuSnap], [gpuSnap]]}
      cpuTemp={null}
      mem={mem}
      reduced={reduced}
    />,
  );

describe("MonitorDomainCards (T3+T4b)", () => {
  it("collapsed: one compact card per domain (CPU · GPU · Memory · Cores), no detail rows", () => {
    const { container } = mount();
    expect(container.querySelectorAll(".mdc-face")).toHaveLength(4);
    expect(screen.queryByText("Overall CPU usage")).toBeNull();
    expect(screen.queryByText(/kernel driver/)).toBeNull();
  });

  it("CPU card expands to the FULL classic panel — every row + the driver-free temp note, once", () => {
    const { container } = mount();
    fireEvent.click(screen.getByRole("button", { name: /CPU/ }));
    expect(screen.getByText("Overall CPU usage")).toBeInTheDocument();
    expect(screen.getByText("Clock speed")).toBeInTheDocument();
    expect(screen.getByText("CPU temperature")).toBeInTheDocument();
    expect(screen.getByText("Memory used")).toBeInTheDocument();
    expect(screen.getAllByText(/kernel driver/)).toHaveLength(1);
    expect(container.querySelectorAll(".mdc-detail .cpu-core")).toHaveLength(16);
    // Click again → collapses (toggle, never a dead end).
    fireEvent.click(screen.getByRole("button", { name: /CPU/ }));
    expect(screen.queryByText("Overall CPU usage")).toBeNull();
  });

  it("GPU card expands to the classic GPU panel (AMD rows incl. hotspot + fan)", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /GPU/ }));
    expect(screen.getByText("GPU utilization")).toBeInTheDocument();
    expect(screen.getByText("Hotspot (junction)")).toBeInTheDocument();
    expect(screen.getByText("Fan speed")).toBeInTheDocument();
    expect(screen.getByText("Power draw")).toBeInTheDocument();
  });

  it("Memory card expands to used/swap + top consumers", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Memory/ }));
    expect(screen.getByText("Memory used")).toBeInTheDocument();
    expect(screen.getByText("Swap used")).toBeInTheDocument();
    expect(screen.getByText("chrome.exe")).toBeInTheDocument();
  });

  it("Cores card expands to the per-core grid", () => {
    const { container } = mount();
    fireEvent.click(screen.getByRole("button", { name: /Cores/ }));
    expect(container.querySelectorAll(".mdc-detail .cpu-core")).toHaveLength(16);
  });

  it("reduced motion: values render as plain text — no sliding reels", () => {
    const { container } = mount(true);
    expect(container.querySelector(".sln-reel")).toBeNull();
    expect(container.querySelectorAll(".sln").length).toBeGreaterThan(0);
  });

  // bug→guard (self-review catch 2026-07-06): the domain cards duplicated LiveCharts'
  // CPU/GPU/Memory headline row on the same screen. Pin at the source: Play renders
  // LiveCharts ONLY when the monitor-cards flag is off — one screen never shows the same
  // domain headlines twice.
  it("Play gates LiveCharts behind !readMonitorCards() (no doubled domain headlines)", () => {
    // Vite-native raw source read (same pattern as doorknob-guard) — no fs typing quirks.
    const play = Object.entries(
      import.meta.glob("./Play.tsx", { query: "?raw", import: "default", eager: true }) as Record<
        string,
        string
      >,
    )[0][1];
    const render273 = play.match(/\{showLive &&[\s\S]{0,200}?<LiveCharts \/>\}/);
    expect(render273, "LiveCharts render site not found in Play.tsx").not.toBeNull();
    expect(render273![0]).toContain("!readMonitorCards()");
  });

  it("renders nothing before the first sample (parent owns the collecting state)", () => {
    const { container } = render(
      <MonitorDomainCards cpuSamples={[]} gpuSamples={[]} cpuTemp={null} mem={null} reduced={false} />,
    );
    expect(container.querySelector(".mdc-root")).toBeNull();
  });
});
