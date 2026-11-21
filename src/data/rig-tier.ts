// Rough rig tier (owner-greenlit 2026-06-22) — a TRANSPARENT, spec-derived band, never a fabricated
// verdict. The honest framing: it's computed from three MEASURED facts (GPU memory, physical CPU cores,
// total RAM), the method is stated to the user, and the bands are conservative so a single strong spec
// can't carry a rig. It is explicitly "rough, from your specs" — NOT an authoritative GPU-class ranking
// (that would need a curated model database). Pure + testable; no network, no fabrication.
//
// Conservative composite (a strong rig must be strong on ALL THREE axes; a clearly-limited rig is weak
// on ANY axis): so a 16 GB mid-range card with a 4-core CPU reads "Mid", not "High".

export type RigTier = "Entry" | "Mid" | "High";

import { GIB } from "./ram-format";

export function rigTier(vramBytes: number, physicalCores: number, ramBytes: number): RigTier {
  const vramGb = vramBytes / GIB;
  const ramGb = ramBytes / GIB;
  const cores = physicalCores;
  // High: comfortably strong on every axis at once.
  if (vramGb >= 12 && cores >= 8 && ramGb >= 16) return "High";
  // Entry: clearly limited on any one axis (modern-gaming floors: <6 GB VRAM / <4 cores / <8 GB RAM).
  if (vramGb < 6 || cores < 4 || ramGb < 8) return "Entry";
  return "Mid";
}

// One honest line naming the inputs, so the tier is never a black-box claim — the user sees exactly
// what it's read from. Returns null when any input is unreadable: the probe's unknown is 0, and a
// tier read from "0 GB VRAM" is a tier from nothing (codebase review 2026-11-02).
export function rigTierLine(
  vramBytes: number,
  physicalCores: number,
  ramBytes: number,
  /** The modules' sum (ram-format `installedRamGB`), when every module was read. The tier and its
   *  basis line then use INSTALLED memory, the number the memory card shows ("32 GB"), not Windows'
   *  usable total ("31 GB"): one panel never prints two different RAM figures. */
  installedGb: number | null = null,
): { tier: RigTier; basis: string } | null {
  const read = (n: number) => Number.isFinite(n) && n > 0;
  if (!read(vramBytes) || !read(physicalCores) || !read(ramBytes)) return null;
  const ramForTier = installedGb != null && installedGb > 0 ? installedGb * GIB : ramBytes;
  const tier = rigTier(vramBytes, physicalCores, ramForTier);
  const vramGb = Math.round(vramBytes / GIB);
  const ramGb = Math.round(ramForTier / GIB);
  // Without the module sum the figure is Windows' usable total, and the line says so.
  const ram = installedGb != null && installedGb > 0 ? `${ramGb} GB RAM` : `${ramGb} GB usable RAM`;
  return {
    tier,
    basis: `rough, from ${vramGb} GB VRAM · ${physicalCores} cores · ${ram}`,
  };
}
