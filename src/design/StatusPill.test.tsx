import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusPill } from "./StatusPill";

describe("StatusPill", () => {
  it("shows the status label by default", () => {
    render(<StatusPill status="ready" />);
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });
  it("respects a custom label", () => {
    render(<StatusPill status="attention" label="1 to review" />);
    expect(screen.getByText("1 to review")).toBeInTheDocument();
  });
});
