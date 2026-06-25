import { describe, it, expect } from "vitest";
import {
  msiStatus,
  usbShared,
  usbStatus,
  fmtMs,
  timerRangeLabel,
  pollingJitterStatus,
  pollingJitterLabel,
} from "./latency-view";
import type { UsbControllerLoad } from "../types";

describe("msiStatus", () => {
  it("flags advertised-but-inactive as attention", () => {
    expect(
      msiStatus({ active_on: 5, active_off: 1, unknown: 0, advertised_but_inactive: 1 })
    ).toBe("attention");
  });
  it("reads clean active MSI as ready", () => {
    expect(
      msiStatus({ active_on: 5, active_off: 0, unknown: 2, advertised_but_inactive: 0 })
    ).toBe("ready");
  });
  it("no confirmed MSI -> unknown (never a guess)", () => {
    expect(
      msiStatus({ active_on: 0, active_off: 0, unknown: 0, advertised_but_inactive: 0 })
    ).toBe("unknown");
  });
});

describe("usb", () => {
  // Mouse + a streaming audio dongle → the real, actionable jitter risk.
  const streaming: UsbControllerLoad[] = [
    {
      controller_name: "c",
      controller_id: "x",
      input_devices: ["HID-compliant mouse"],
      streaming_neighbors: ["USB Audio"],
      has_high_rate_input: true,
    },
  ];
  // Mouse + keyboard → benign quiet sharing (Info, never an alarm).
  const quiet: UsbControllerLoad[] = [
    {
      controller_name: "c",
      controller_id: "x",
      input_devices: ["HID-compliant mouse", "kbd"],
      streaming_neighbors: [],
      has_high_rate_input: true,
    },
  ];
  const solo: UsbControllerLoad[] = [
    {
      controller_name: "c",
      controller_id: "x",
      input_devices: ["HID-compliant mouse"],
      streaming_neighbors: [],
      has_high_rate_input: true,
    },
  ];
  it("flags only the actionable (streaming) case as shared — quiet sharing is not an alarm", () => {
    expect(usbShared(streaming)).toBe(true);
    expect(usbShared(quiet)).toBe(false);
    expect(usbShared(solo)).toBe(false);
  });
  it("maps streaming->attention, quiet->info, solo->ready, empty->unknown", () => {
    expect(usbStatus(streaming)).toBe("attention");
    expect(usbStatus(quiet)).toBe("info");
    expect(usbStatus(solo)).toBe("ready");
    expect(usbStatus([])).toBe("unknown");
  });
});

describe("fmtMs", () => {
  it("uses 2 decimals sub-10ms, 1 above", () => {
    expect(fmtMs(0.51)).toBe("0.51 ms");
    expect(fmtMs(15.6)).toBe("15.6 ms");
  });
});

describe("timerRangeLabel", () => {
  // Dev-rig-like values: coarsest 156250×100ns = 15.625 ms, finest 5000×100ns = 0.50 ms.
  it("names the finest and coarsest supported resolution with fmtMs precision", () => {
    const label = timerRangeLabel({ coarsest_100ns: 156250, finest_100ns: 5000, current_100ns: 10000 });
    expect(label).toContain("0.50 ms (finest)"); // sub-10ms → 2 decimals
    expect(label).toContain("15.6 ms (coarsest)"); // ≥10ms → 1 decimal
    expect(label).toContain("0.50 ms is as fine as it goes"); // names the real floor (debunks "force 0.5 ms")
  });
  it("reads sensibly when the window collapses to a single supported value", () => {
    const label = timerRangeLabel({ coarsest_100ns: 10000, finest_100ns: 10000, current_100ns: 10000 });
    expect(label).toContain("1.00 ms (finest)");
    expect(label).toContain("1.00 ms (coarsest)");
  });
});

describe("pollingJitterStatus", () => {
  it("bands jitter: tight <0.5 → ready, 0.5–1.5 → info, >1.5 → attention", () => {
    expect(pollingJitterStatus(0.2)).toBe("ready");
    expect(pollingJitterStatus(0.49)).toBe("ready");
    expect(pollingJitterStatus(0.5)).toBe("info"); // 0.5 boundary = normal, not tight
    expect(pollingJitterStatus(1.0)).toBe("info");
    expect(pollingJitterStatus(1.5)).toBe("info"); // 1.5 boundary = normal, not high
    expect(pollingJitterStatus(1.51)).toBe("attention");
    expect(pollingJitterStatus(4.0)).toBe("attention");
  });
  it("non-finite / negative → unknown (never a guessed verdict)", () => {
    expect(pollingJitterStatus(NaN)).toBe("unknown");
    expect(pollingJitterStatus(Infinity)).toBe("unknown");
    expect(pollingJitterStatus(-0.1)).toBe("unknown");
  });
});

describe("pollingJitterLabel", () => {
  it("plain-word bands match pollingJitterStatus", () => {
    expect(pollingJitterLabel(0.2)).toBe("tight");
    expect(pollingJitterLabel(1.0)).toBe("normal");
    expect(pollingJitterLabel(2.0)).toBe("high");
    expect(pollingJitterLabel(NaN)).toBe("unknown");
  });
});
