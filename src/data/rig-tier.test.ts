import { describe, it, expect } from "vitest";
import { rigTier, rigTierLine } from "./rig-tier";

const GIB = 1024 ** 3;

describe("rigTier — conservative spec composite", () => {
  it("is High only when GPU memory, cores AND RAM are all strong", () => {
    expect(rigTier(16 * GIB, 8, 32 * GIB)).toBe("High"); // the dev rig (RX 9070 XT)
    expect(rigTier(12 * GIB, 8, 16 * GIB)).toBe("High"); // exactly on the floors
  });

  it("a single strong axis cannot carry a rig to High (no VRAM-alone inflation)", () => {
    // 16 GB VRAM but only 4 cores → Mid, not High (the conservative-composite point).
    expect(rigTier(16 * GIB, 4, 16 * GIB)).toBe("Mid");
    // Strong GPU+CPU but 8 GB RAM → Mid (RAM axis not strong).
    expect(rigTier(16 * GIB, 8, 8 * GIB)).toBe("Mid");
    // Strong CPU+RAM but an 8 GB GPU → Mid (GPU memory axis not strong).
    expect(rigTier(8 * GIB, 8, 32 * GIB)).toBe("Mid");
  });

  it("is Entry when any axis is clearly limited", () => {
    expect(rigTier(4 * GIB, 8, 32 * GIB)).toBe("Entry"); // <6 GB VRAM
    expect(rigTier(16 * GIB, 2, 32 * GIB)).toBe("Entry"); // <4 cores
    expect(rigTier(16 * GIB, 8, 4 * GIB)).toBe("Entry"); // <8 GB RAM
  });

  it("is Mid for a balanced mid rig", () => {
    expect(rigTier(8 * GIB, 6, 16 * GIB)).toBe("Mid");
  });
});

describe("rigTierLine — transparent basis, never fabricated", () => {
  it("names the exact inputs the tier was read from", () => {
    const line = rigTierLine(16 * GIB, 8, 32 * GIB);
    expect(line?.tier).toBe("High");
    expect(line?.basis).toContain("16 GB VRAM");
    expect(line?.basis).toContain("8 cores");
    expect(line?.basis).toContain("32 GB RAM");
    expect(line?.basis).toContain("rough"); // never presented as authoritative
  });

  it("returns null when nothing is readable (no tier from nothing)", () => {
    expect(rigTierLine(0, 0, 0)).toBeNull();
  });
});
