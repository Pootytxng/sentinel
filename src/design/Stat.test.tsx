import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Stat } from "./Stat";

describe("Stat", () => {
  it("renders value, unit, and label", () => {
    render(<Stat value="142" unit="fps" label="Average" />);
    expect(screen.getByText("142")).toBeInTheDocument();
    expect(screen.getByText("fps")).toBeInTheDocument();
    expect(screen.getByText("Average")).toBeInTheDocument();
  });
});
