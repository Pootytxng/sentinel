import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Walkthrough } from "./Walkthrough";
import { walkthroughForKey } from "../surfaces/walkthroughs";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? matches : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

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

  // ── §B single-panel stepper (spec 2026-06-12) ──

  it("renders exactly ONE schematic panel with stepper controls — never the 5-stack", () => {
    stubReducedMotion(false);
    const wt = walkthroughForKey("amd-gpu-undervolt")!;
    const { container } = render(<Walkthrough walkthrough={wt} vendor="amd" />);
    expect(container.querySelectorAll(".wt-stage").length).toBe(1);
    expect(container.querySelector(".wt-storyboard")).toBeNull();
    expect(screen.getByRole("button", { name: "Previous step" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next step" })).toBeInTheDocument();
    expect(container.querySelectorAll(".wt-dot").length).toBe(wt.variants[0].steps.length);
  });

  it("prev/next/dots drive the active step and take the wheel (cursor glide stops)", () => {
    stubReducedMotion(false);
    const wt = walkthroughForKey("amd-gpu-undervolt")!;
    const { container } = render(<Walkthrough walkthrough={wt} vendor="amd" />);
    expect(container.querySelector(".wt-cursor")).not.toBeNull(); // auto mode glides
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(container.querySelectorAll(".wt-step")[1]?.className).toContain("wt-step-on");
    expect(container.querySelector(".wt-cursor")).toBeNull(); // manual = the user drives
    fireEvent.click(screen.getByRole("button", { name: "Previous step" }));
    expect(container.querySelectorAll(".wt-step")[0]?.className).toContain("wt-step-on");
  });

  it("reduced-motion = the SAME single panel as a MANUAL stepper (no cursor, controls work)", () => {
    stubReducedMotion(true);
    const wt = walkthroughForKey("amd-gpu-undervolt")!;
    const { container } = render(<Walkthrough walkthrough={wt} vendor="amd" />);
    expect(container.querySelectorAll(".wt-stage").length).toBe(1);
    expect(container.querySelector(".wt-storyboard")).toBeNull();
    expect(container.querySelector(".wt-cursor")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(container.querySelectorAll(".wt-step")[1]?.className).toContain("wt-step-on");
  });

  it("prev from the first step wraps to the last (no dead control — doorknob honesty)", () => {
    stubReducedMotion(true);
    const wt = walkthroughForKey("amd-gpu-undervolt")!;
    const { container } = render(<Walkthrough walkthrough={wt} vendor="amd" />);
    fireEvent.click(screen.getByRole("button", { name: "Previous step" }));
    const steps = container.querySelectorAll(".wt-step");
    expect(steps[steps.length - 1]?.className).toContain("wt-step-on");
  });
});
