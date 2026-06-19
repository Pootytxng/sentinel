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
  const orig = window.matchMedia;
  afterEach(() => {
    window.matchMedia = orig;
  });

  it("renders the final value immediately under prefers-reduced-motion (no animation)", () => {
    window.matchMedia = ((q: string) => ({
      matches: true,
      media: q,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
    render(<AnimatedNumber value={246} />);
    expect(screen.getByText("246")).toBeInTheDocument();
  });

  it("honors a custom formatter under reduced motion", () => {
    window.matchMedia = ((q: string) => ({
      matches: true,
      media: q,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
    render(<AnimatedNumber value={4.13} format={(v) => v.toFixed(1)} />);
    expect(screen.getByText("4.1")).toBeInTheDocument();
  });
});
