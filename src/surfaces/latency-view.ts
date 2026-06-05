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

/** Per-controller severity — mirrors the Rust `UsbControllerLoad::severity()`. Amber **attention**
 * ONLY when a high-rate input shares the controller with a streaming neighbor (a real, actionable
 * jitter risk). Quiet sharing (mouse + keyboards/HID) is neutral **info** — education, not alarm. */
export function controllerSeverity(c: UsbControllerLoad): "attention" | "info" | "none" {
  const shared =
    c.input_devices.length >= 2 ||
    (c.input_devices.length > 0 && c.streaming_neighbors.length > 0);
  if (!shared) return "none";
  if (c.has_high_rate_input && c.streaming_neighbors.length > 0) return "attention";
  return "info";
}

/** True ONLY for the actionable (attention) case — what a counter/rollup may key on. Quiet sharing
 * is Info and deliberately excluded so it never inflates an attention count. */
export function usbShared(usb: UsbControllerLoad[]): boolean {
  return usb.some((c) => controllerSeverity(c) === "attention");
}

export function usbStatus(usb: UsbControllerLoad[]): Status {
  if (usb.length === 0) return "unknown";
  if (usb.some((c) => controllerSeverity(c) === "attention")) return "attention";
  if (usb.some((c) => controllerSeverity(c) === "info")) return "info";
  return "ready";
}

/** Format milliseconds with precision suited to the value: sub-millisecond timer
 * figures want 2 decimals, coarser wake times read fine at 1. */
export function fmtMs(ms: number): string {
  return ms < 10 ? `${ms.toFixed(2)} ms` : `${ms.toFixed(1)} ms`;
}
