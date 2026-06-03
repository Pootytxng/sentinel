// Pure presentation helpers for the Latency tab — derive status pills and format
// values. Kept separate from the component so they're unit-tested without a DOM.
import type { Status } from "../design";
import type { MsiActiveSummary, UsbControllerLoad } from "../types";

/** MSI health from the VERIFIED active state: any device that advertises MSI but
 * actually runs on a line IRQ is worth a heads-up; otherwise devices confirmed on
 * MSI read as ready. No verifiable data → unknown (never a guess). */
export function msiStatus(s: MsiActiveSummary): Status {
  if (s.advertised_but_inactive > 0) return "attention";
  if (s.active_on > 0) return "ready";
  return "unknown";
}

/** A controller carrying 2+ input devices is the "shared controller" condition —
 * a low-drama heads-up, not a fault. */
export function usbShared(usb: UsbControllerLoad[]): boolean {
  return usb.some((c) => c.input_devices.length >= 2);
}

export function usbStatus(usb: UsbControllerLoad[]): Status {
  if (usb.length === 0) return "unknown";
  return usbShared(usb) ? "attention" : "ready";
}

/** Format milliseconds with precision suited to the value: sub-millisecond timer
 * figures want 2 decimals, coarser wake times read fine at 1. */
export function fmtMs(ms: number): string {
  return ms < 10 ? `${ms.toFixed(2)} ms` : `${ms.toFixed(1)} ms`;
}
