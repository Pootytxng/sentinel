import { describe, it, expect } from "vitest";
import { fmtGB, fmtGHz, shortGpu } from "./hardware-format";

describe("hardware-format", () => {
  it("fmtGB formats bytes to GB (1 decimal)", () => {
    expect(fmtGB(32 * 1024 ** 3)).toBe("32.0 GB");
    expect(fmtGB(0)).toBe("0.0 GB");
  });

  it("fmtGHz formats MHz, em-dash on zero/absent", () => {
    expect(fmtGHz(5100)).toBe("5.10 GHz");
    expect(fmtGHz(0)).toBe("—");
  });

  describe("shortGpu — keep the model, strip vendor + marketing words", () => {
    it("AMD keeps the RX series prefix (the bug the old slice(-2) dropped)", () => {
      expect(shortGpu("AMD Radeon RX 9070 XT")).toBe("RX 9070 XT");
    });
    it("NVIDIA keeps RTX", () => {
      expect(shortGpu("NVIDIA GeForce RTX 4070")).toBe("RTX 4070");
    });
    it("Intel Arc is preserved", () => {
      expect(shortGpu("Intel Arc A770")).toBe("Arc A770");
    });
    it("falls back to the full name when stripping leaves nothing (e.g. an iGPU)", () => {
      expect(shortGpu("AMD Radeon Graphics")).toBe("AMD Radeon Graphics");
    });
    it("empty name → em-dash", () => {
      expect(shortGpu("")).toBe("—");
    });
  });
});
