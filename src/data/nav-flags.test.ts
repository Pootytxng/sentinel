import { describe, it, expect, vi, afterEach } from "vitest";
import { readOptimizeMerged, readMonitorMerged } from "./nav-flags";

// Guard for the robustness-audit fix: these flags are read in a component RENDER body, and a bare
// localStorage.getItem THROWS on WebView2 configs where storage is disabled/partitioned — with no
// React error boundary that blanks the whole app. The readers MUST swallow the throw and default
// merged-ON, never let it propagate.
afterEach(() => {
  vi.restoreAllMocks();
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe("nav-flags guarded readers", () => {
  it("default to merged-ON when the flag is unset", () => {
    expect(readOptimizeMerged()).toBe(true);
    expect(readMonitorMerged()).toBe(true);
  });

  it('honor the "0" escape hatch (classic separate surfaces)', () => {
    localStorage.setItem("compy_optimize", "0");
    localStorage.setItem("compy_monitor", "0");
    expect(readOptimizeMerged()).toBe(false);
    expect(readMonitorMerged()).toBe(false);
  });

  it("never throw when localStorage.getItem throws — default merged-ON (no blank app)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    expect(() => readOptimizeMerged()).not.toThrow();
    expect(() => readMonitorMerged()).not.toThrow();
    expect(readOptimizeMerged()).toBe(true);
    expect(readMonitorMerged()).toBe(true);
  });
});
