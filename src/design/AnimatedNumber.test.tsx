import { describe, it, expect, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { easeOutCubic, AnimatedNumber } from "./AnimatedNumber";

describe("easeOutCubic", () => {
  it("clamps to [0,1] and eases out", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(-3)).toBe(0); // clamp low
    expect(easeOutCubic(9)).toBe(1); // clamp high
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 3); // 1-(1-0.5)^3
  });
});

describe("AnimatedNumber — accessibility", () => {
  // Reduced behavior is driven by the app Motion pref now (overrides the OS by default), so force the
  // "reduced" pref rather than mocking matchMedia.
  afterEach(() => {
    try {
      localStorage.removeItem("compy_motion");
    } catch {
      /* ignore */
    }
  });

  it("renders the final value immediately when Motion is set to Reduced (no animation)", () => {
    localStorage.setItem("compy_motion", "reduced");
    render(<AnimatedNumber value={246} />);
    expect(screen.getByText("246")).toBeInTheDocument();
  });

  it("honors a custom formatter when Motion is set to Reduced", () => {
    localStorage.setItem("compy_motion", "reduced");
    render(<AnimatedNumber value={4.13} format={(v) => v.toFixed(1)} />);
    expect(screen.getByText("4.1")).toBeInTheDocument();
  });
});
