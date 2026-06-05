import { describe, it, expect } from "vitest";
import { msiStatus, usbShared, usbStatus, fmtMs } from "./latency-view";
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
