import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { LatencyReport } from "../types";

// Settable per-test responses (hoisted — vi.mock factories run before imports).
const mocks = vi.hoisted(() => ({
  report: null as LatencyReport | null,
  mouse: null as unknown,
  mouseError: false, // when true, latency_measure_mouse rejects (simulates a capture failure)
  hw: null as unknown, // get_hardware_info — only network_pills is read by this surface
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_latency_diagnostics") return Promise.resolve(mocks.report);
    if (cmd === "latency_measure_mouse")
      return mocks.mouseError
        ? Promise.reject(new Error("capture failed"))
        : Promise.resolve(mocks.mouse);
    if (cmd === "get_hardware_info") return Promise.resolve(mocks.hw);
    return Promise.resolve(null);
  }),
}));

import { LatencyTab } from "./Latency";

afterEach(() => {
  cleanup();
  mocks.hw = null; // don't leak the network signal into other tests' ordering
  mocks.mouseError = false;
});

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

  it("surfaces the USB top-spec tier and the tier advisory honestly", async () => {
    mocks.report = {
      ...fullReport,
      usb_top_spec: "USB 3.2",
      usb_tier_advisory:
        "Your system supports up to USB 3.2. A faster USB port does NOT raise a mouse's polling rate.",
    };
    render(<LatencyTab />);
    // The capability tier is shown, explicitly labelled as a tier (not a per-port speed).
    expect(await screen.findByText(/Platform supports up to/)).toBeInTheDocument();
    expect(screen.getByText("USB 3.2")).toBeInTheDocument();
    expect(screen.getByText(/capability tier — not a\s+per-port speed/)).toBeInTheDocument();
    // The honest tier advisory renders.
    expect(
      screen.getByText(/A faster USB port does NOT raise a mouse's polling rate/),
    ).toBeInTheDocument();
  });

  it("renders network-readiness chips from the backend signal, tone-classed, never alarming", async () => {
    mocks.report = fullReport;
    mocks.hw = {
      network_pills: [
        { label: "Wi-Fi · 5 GHz", tone: "advisory" },
        { label: "82% signal", tone: "neutral" },
        { label: "Wired port available", tone: "advisory" },
        { label: "Offline", tone: "unknown" },
        { label: "danger", tone: "danger" }, // a hypothetical future/alarming tone → defused to neutral
      ],
    };
    render(<LatencyTab />);
    // The card and its honest context line render.
    expect(await screen.findByText("Network connection")).toBeInTheDocument();
    expect(screen.getByText(/shapes online-game latency \(ping and lag\)/)).toBeInTheDocument();
    // Each pill shows its label, colored by tone — and NONE carries an alarm/danger class.
    const advisory = screen.getByText("Wi-Fi · 5 GHz");
    expect(advisory).toHaveClass("lat-pill", "lat-pill-advisory");
    expect(screen.getByText("82% signal")).toHaveClass("lat-pill-neutral");
    expect(screen.getByText("Offline")).toHaveClass("lat-pill-unknown");
    // The unknown future tone is defused to the calm neutral class (never borrows an alarming one).
    expect(screen.getByText("danger")).toHaveClass("lat-pill-neutral");
  });

  it("hides the network card entirely when the signal is absent (never an empty shell)", async () => {
    mocks.report = fullReport;
    mocks.hw = null; // get_hardware_info unavailable / no pills
    render(<LatencyTab />);
    // The rest of the surface still renders…
    expect(await screen.findByText(/Nothing here\s+changes a setting/)).toBeInTheDocument();
    // …but no Network connection card appears.
    expect(screen.queryByText("Network connection")).not.toBeInTheDocument();
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

  // bug→guard: mouseMsg was only rendered in the no-result branch, so once a measurement existed a
  // failed "Measure again" was swallowed silently (and the re-measure coaching prompt vanished). The
  // capture status must render in BOTH states. This guards the failure half (the clearest signal).
  it("surfaces a failed re-measure instead of failing silently, keeping the prior result", async () => {
    mocks.report = fullReport;
    mocks.mouse = {
      polling: { reports: 1980, median_hz: 998.7, min_interval_ms: 0.9, max_interval_ms: 1.4, jitter_ms: 0.1 },
      note: "Consistent with a 1000 Hz mouse.",
    };
    render(<LatencyTab />);
    // Get into the result state (the "Measure again" button only exists once a result is present).
    fireEvent.click(await screen.findByRole("button", { name: "Measure mouse polling" }));
    const again = await screen.findByRole("button", { name: "Measure again" });
    // The re-measure fails — the message must appear even though a prior result is still shown.
    mocks.mouseError = true;
    fireEvent.click(again);
    expect(await screen.findByText("Measurement failed.")).toBeInTheDocument();
    // The prior measurement is preserved, not blown away by the failure.
    expect(screen.getByText(/999 Hz/)).toBeInTheDocument();
  });
});
