import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
vi.mock("../use-motion", () => ({ useReducedMotion: () => true })); // reduced ⇒ useCountTo snaps (deterministic)
import { ArcGauge } from "./ArcGauge";

describe("ArcGauge", () => {
  it("renders an honest NOT-YET state when value is null — never a fabricated number", () => {
    render(<ArcGauge label="GPU temp" value={null} max={100} unit="°C" />);
    expect(screen.getByText(/not yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/^\d+$/)).toBeNull(); // no numeric readout at all
  });
  it("renders the measured value + a 'measured' tag when a real value is present", () => {
    render(<ArcGauge label="Safe stack" value={7} max={9} unit="ready" measured />);
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText(/measured/i)).toBeInTheDocument();
  });
});
