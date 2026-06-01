import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Gauge } from "./Gauge";

describe("Gauge", () => {
  it("renders the label and the display value", () => {
    render(<Gauge value={61} display="61" unit="°C" label="GPU temp" />);
    expect(screen.getByText("GPU temp")).toBeInTheDocument();
    expect(screen.getByText("61")).toBeInTheDocument();
  });
});
