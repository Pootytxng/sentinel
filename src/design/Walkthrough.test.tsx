import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Walkthrough } from "./Walkthrough";
import { walkthroughForKey } from "../surfaces/walkthroughs";

describe("Walkthrough", () => {
  it("renders the title, every step caption, and per-vendor variant tabs", () => {
    render(<Walkthrough walkthrough={walkthroughForKey("vrr")!} vendor="amd" />);
    expect(screen.getByText(/variable refresh/i)).toBeInTheDocument();
    // AMD variant is selected for an AMD rig; its first step caption shows (unique to the caption).
    expect(screen.getByText(/Right-click the desktop, open AMD Software/i)).toBeInTheDocument();
    // both vendor tabs exist
    expect(screen.getByRole("tab", { name: "AMD" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "NVIDIA" })).toBeInTheDocument();
  });

  it("switching the variant tab swaps the steps", () => {
    render(<Walkthrough walkthrough={walkthroughForKey("vrr")!} vendor="amd" />);
    fireEvent.click(screen.getByRole("tab", { name: "NVIDIA" }));
    expect(screen.getByText(/open NVIDIA Control Panel/i)).toBeInTheDocument();
  });

  it("pairs with an existing allowlisted deep link when one is defined", () => {
    render(<Walkthrough walkthrough={walkthroughForKey("storage-sense")!} vendor="any" />);
    expect(screen.getByRole("button", { name: /Open Storage settings/i })).toBeInTheDocument();
    // honesty label always present — never pretends to be the real screen
    expect(screen.getByText(/Schematic/i)).toBeInTheDocument();
  });
});
