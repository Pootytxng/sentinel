import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { LatencyReport } from "../types";

// Settable per-test responses (hoisted — vi.mock factories run before imports).
const mocks = vi.hoisted(() => ({
  report: null as LatencyReport | null,
  mouse: null as unknown,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_latency_diagnostics") return Promise.resolve(mocks.report);
    if (cmd === "latency_measure_mouse") return Promise.resolve(mocks.mouse);
    return Promise.resolve(null);
  }),
}));

import { LatencyTab } from "./Latency";

afterEach(cleanup);

const fullReport: LatencyReport = {
  msi_devices: [],
  msi: { total: 6, msi_on: 5, msi_off: 1 },
  msi_active: { active_on: 4, active_off: 1, unknown: 1, advertised_but_inactive: 1 },
  msi_advisory: "One device advertises MSI but runs on a line IRQ.",
  line_irq_receipts: [
    { name: "Intel Ethernet I226-V", advertises_msi: true, latency_sensitive: true },
  ],
  timer: null,
  timer_current_ms: 15.6,
  cpu: { logical_processors: 16, physical_cores: 8, l3_complexes: 1 },
  cpu_affinity_advisory: null,
  usb: [
    {
      controller_name: "USB xHCI Controller",
      controller_id: "ctrl-1",
      input_devices: ["Gaming Mouse"],
      streaming_neighbors: ["Webcam"],
      has_high_rate_input: true,
    },
  ],
  usb_advisory: null,
};

describe("LatencyTab (audit M1)", () => {
  it("degrades honestly when diagnostics can't be read", async () => {
    mocks.report = null;
    render(<LatencyTab />);
    expect(await screen.findByText("Diagnostics unavailable on this machine.")).toBeInTheDocument();
  });

  it("renders the read-only promise and receipt-style MSI counts", async () => {
    mocks.report = fullReport;
    render(<LatencyTab />);
    // The honesty header: this tab measures, never mutates.
    expect(await screen.findByText(/Nothing here\s+changes a setting/)).toBeInTheDocument();
    // Receipts: exact counts, incl. the advertised-but-inactive honesty split.
    expect(
      screen.getByText(/4 of 6 capable devices confirmed on MSI.*1 advertise it but run on a line IRQ.*1 undetermined/),
    ).toBeInTheDocument();
    expect(screen.getByText(fullReport.msi_advisory!)).toBeInTheDocument();
    // "Name the guilty device": the verified line-IRQ offender is NAMED with its state.
    expect(screen.getByText("Intel Ethernet I226-V")).toBeInTheDocument();
    expect(screen.getByText(/advertises MSI · verified running on a line IRQ/)).toBeInTheDocument();
    expect(screen.getByText("latency-sensitive")).toBeInTheDocument();
    // CPU topology + USB inventory name their evidence.
    expect(screen.getByText(/8 cores \/ 16 threads/)).toBeInTheDocument();
    expect(screen.getByText("USB xHCI Controller")).toBeInTheDocument();
  });

  it("time-windowed measurements are on-demand and report honestly when empty", async () => {
    mocks.report = fullReport;
    mocks.mouse = null; // capture window caught nothing
    render(<LatencyTab />);
    const btn = await screen.findByRole("button", { name: "Measure mouse polling" });
    fireEvent.click(btn);
    // No fabricated number: an empty capture says so and offers a retry.
    expect(
      await screen.findByText(/No mouse reports captured — try again and keep the mouse moving\./),
    ).toBeInTheDocument();
    mocks.mouse = {
      polling: { reports: 1980, median_hz: 998.7, min_interval_ms: 0.9, max_interval_ms: 1.4, jitter_ms: 0.1 },
      note: "Consistent with a 1000 Hz mouse.",
    };
    fireEvent.click(screen.getByRole("button", { name: "Measure mouse polling" }));
    expect(await screen.findByText(/999 Hz/)).toBeInTheDocument();
    expect(screen.getByText(/over\s+1980 reports/)).toBeInTheDocument();
  });
});
