// Shared hardware-value formatters. Used by the App monitoring tabs AND the shared HardwareGrid
// (which renders on the Home surfaces). Kept here, dependency-free, so HardwareGrid can reuse
// them without a runtime import cycle back into App.tsx.
import { ramGB } from "../data/ram-format";

// A size in Windows' "GB" (1024^3). Memory TOTALS go through src/data/ram-format.ts (usableRam), which
// says "usable"; this one is for sizes that are not the RAM total (in use, swap, disks).
export const fmtGB = (bytes: number) => `${ramGB(bytes)} GB`;
export const fmtGHz = (mhz: number) => (mhz > 0 ? `${(mhz / 1000).toFixed(2)} GHz` : "—");

// Compact a GPU name to its model for a glance card — strip vendor + marketing words, keep the model
// ("AMD Radeon RX 9070 XT" → "RX 9070 XT", "NVIDIA GeForce RTX 4070" → "RTX 4070", "Intel Arc A770" →
// "Arc A770"). Falls back to the full name if stripping leaves nothing.
export function shortGpu(name: string): string {
  if (!name) return "—";
  const model = name
    .replace(/\b(AMD|NVIDIA|Intel|Radeon|GeForce|Graphics|Series)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return model || name;
}
