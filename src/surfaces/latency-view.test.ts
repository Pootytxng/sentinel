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
  const shared: UsbControllerLoad[] = [
    { controller_name: "c", controller_id: "x", input_devices: ["mouse", "kbd"] },
  ];
  const solo: UsbControllerLoad[] = [
    { controller_name: "c", controller_id: "x", input_devices: ["mouse"] },
  ];
  it("detects the shared-controller condition", () => {
    expect(usbShared(shared)).toBe(true);
    expect(usbShared(solo)).toBe(false);
  });
  it("maps shared->attention, solo->ready, empty->unknown", () => {
    expect(usbStatus(shared)).toBe("attention");
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
