import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Sparkline } from "./Sparkline";

describe("Sparkline", () => {
  it("renders a polyline with one point per value", () => {
    const { container } = render(<Sparkline values={[1, 2, 3, 4]} />);
    const pts = container.querySelector("polyline")?.getAttribute("points")?.trim().split(/\s+/);
    expect(pts).toHaveLength(4);
  });
  it("renders nothing for empty values (no NaN path)", () => {
    const { container } = render(<Sparkline values={[]} />);
    expect(container.querySelector("polyline")).toBeNull();
  });
});
