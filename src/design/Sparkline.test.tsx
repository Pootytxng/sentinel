import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Sparkline } from "./Sparkline";

describe("Sparkline", () => {
  it("draws a polyline for >=2 values", () => {
    const { container } = render(<Sparkline values={[1, 5, 3, 8]} />);
    expect(container.querySelector("polyline")).toBeInTheDocument();
  });
  it("draws nothing for a single value", () => {
    const { container } = render(<Sparkline values={[1]} />);
    expect(container.querySelector("polyline")).toBeNull();
  });
});
