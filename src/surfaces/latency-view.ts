// Pure presentation helpers for the Latency tab — derive status pills and format
// values. Kept separate from the component so they're unit-tested without a DOM.
import type { Status } from "../design";
import type { MsiActiveSummary, TimerResolution, UsbControllerLoad } from "../types";

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

/** Windows reports the timer resolution it ALLOWS as a [finest, coarsest] window (NtQueryTimerResolution);
 * `finest_100ns` is the most precise (smallest interval) the machine supports, `coarsest_100ns` the least.
 * The UI only ever showed the *current* value — this surfaces the supported range, which is the honest
 * answer to the "force 0.5 ms" guides: it names the real floor (`finest`) below which no setting can go on
 * this machine. 100-ns units → ms is `/ 10_000`. Pure + factual: just the measured window, no verdict. */
export function timerRangeLabel(timer: TimerResolution): string {
  const finestMs = timer.finest_100ns / 10_000;
  const coarsestMs = timer.coarsest_100ns / 10_000;
  return `Windows can run this timer between ${fmtMs(finestMs)} (finest) and ${fmtMs(coarsestMs)} (coarsest) on this machine — ${fmtMs(finestMs)} is as fine as it goes here.`;
}

/** Classify measured mouse-polling jitter (std-dev of report intervals, in ms) into honest bands:
 * **tight** (<0.5 ms) reads ready, **normal** (0.5–1.5 ms) is neutral info, **high** (>1.5 ms) is a
 * heads-up that the effective rate is wobbling. Non-finite / negative input → unknown, never a
 * guessed verdict (jitter is a sample std-dev, so it should be ≥0). Boundaries: 0.5 and 1.5 are
 * inclusive-up — exactly 0.5 ms is normal (not tight), exactly 1.5 ms is normal (not high). */
export function pollingJitterStatus(jitterMs: number): Status {
  if (!Number.isFinite(jitterMs) || jitterMs < 0) return "unknown";
  if (jitterMs < 0.5) return "ready";
  if (jitterMs <= 1.5) return "info";
  return "attention";
}

/** Plain-word band label paired with `pollingJitterStatus` for the pill text. */
export function pollingJitterLabel(jitterMs: number): string {
  if (!Number.isFinite(jitterMs) || jitterMs < 0) return "unknown";
  if (jitterMs < 0.5) return "tight";
  if (jitterMs <= 1.5) return "normal";
  return "high";
}

/** A single network-readiness chip from the backend signal (mirrors `hardware.rs` `NetworkPill`,
 * surfaced on `HardwareInfo.network_pills`). `label` is a plain fact ("Wired Ethernet", "Wi-Fi · 5 GHz",
 * "82% signal"); `tone` is an honest color cue, never a score. */
export type NetworkPill = { label: string; tone: string };

/** The four honest tones the Latency chips render. */
export type NetworkPillTone = "good" | "neutral" | "advisory" | "unknown";

/** Normalize a backend pill `tone` to the calm chip class the Latency surface knows how to color.
 * The four tones map 1:1 (`good` = the steady ideal · `advisory` = worth a glance, never a problem —
 * the same calm accent language as `.lat-advisory` · `neutral` = a plain fact · `unknown` = couldn't
 * read it). Any UNRECOGNIZED tone (a future backend value) falls back to `neutral` so a new tone can
 * never render with no class or — worse — borrow an alarming one. Pure + total: no DOM, fully tested. */
export function networkPillTone(tone: string): NetworkPillTone {
  switch (tone) {
    case "good":
      return "good";
    case "advisory":
      return "advisory";
    case "unknown":
      return "unknown";
    default:
      return "neutral"; // "neutral" itself + any unknown future tone → the safe, calm default
  }
}

/** Plain-English interpretation of the MEASURED effective polling rate (Hz) — translate the raw
 * number into a class a non-technical gamer understands, and make a low rate ACTIONABLE (it names the
 * mouse as the limiter). Bands key off the measured effective rate (already what reaches the game), so
 * no over-claim of an exact advertised tier. `null` for a non-finite / non-positive rate so the card
 * shows nothing rather than a guessed verdict. Boundaries are inclusive-down: 950→gaming, 450→mid,
 * 200→modest, anything positive below→basic. */
export function pollingRateClass(medianHz: number): string | null {
  if (!Number.isFinite(medianHz) || medianHz <= 0) return null;
  if (medianHz >= 950) return "Gaming-class polling rate (≈1000 Hz or better) — plenty for fast aim.";
  if (medianHz >= 450) return "Mid polling rate (≈500 Hz) — fine for most play; gaming mice reach 1000 Hz+.";
  if (medianHz >= 200) return "Modest polling rate (≈250 Hz) — usable, but a gaming mouse polls 1000 Hz+.";
  return "Basic polling rate (≈125 Hz, office-mouse tier) — a gaming mouse polls 1000 Hz+; the mouse is the limiter here.";
}
