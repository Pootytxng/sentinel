import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// Lab + the embedded Benchmark/Latency tabs poll on mount; mock invoke so they don't throw.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

import Lab from "./Lab";

afterEach(cleanup);

describe("Lab", () => {
  it("renders the two instrument sections with plain-English one-liners", () => {
    render(<Lab />);
    // Role-scoped: "Benchmark"/"Latency" also appear in the static welcome band.
    expect(screen.getByRole("button", { name: /Benchmark/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Latency/ })).toBeInTheDocument();
    expect(screen.getByText(/nothing in Advanced\s+changes your PC/)).toBeInTheDocument();
  });

  it("welcome band is static (doorknob law) and gates the Tuning term to AMD", () => {
    const { container } = render(<Lab vendor="nvidia" />);
    const band = container.querySelector(".lab-welcome");
    expect(band).not.toBeNull();
    // Knobless: no door class, no button, nothing clickable inside.
    expect(band!.className).not.toMatch(/cmp-door/);
    expect(band!.querySelector("button, [onclick], a, [role='button']")).toBeNull();
    // Non-AMD rigs never see a dead "Tuning" term.
    expect(band!.textContent).not.toMatch(/Tuning/);
    cleanup();
    const amd = render(<Lab vendor="amd" />).container.querySelector(".lab-welcome");
    expect(amd!.textContent).toMatch(/did your AMD undervolt hold up\?/);
  });

  it("a section expands in place (no route) — navigation never teleports", () => {
    render(<Lab />);
    const benchHeader = screen.getByRole("button", { name: /Benchmark/ });
    expect(benchHeader.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(benchHeader);
    expect(benchHeader.getAttribute("aria-expanded")).toBe("true");
  });

  it("shows the Tuning instrument only on AMD rigs (v1 verified-sensor scope)", () => {
    // Default / NVIDIA: no tuning instrument until its own verified-sensor gate.
    render(<Lab vendor="nvidia" />);
    expect(screen.queryByRole("button", { name: /Tuning/ })).not.toBeInTheDocument();
    cleanup();
    // AMD: the Tuning section appears and expands in place. With NO measured evidence (the
    // invoke mock returns no sessions), §A shows the honest not-for-this-rig state — the guide
    // is OFFERED only when this rig's own sessions show headroom pain (tailoring law).
    render(<Lab vendor="amd" />);
    const tuneHeader = screen.getByRole("button", { name: /Tuning/ });
    fireEvent.click(tuneHeader);
    expect(tuneHeader.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/Not for this rig right now:/)).toBeInTheDocument();
    expect(screen.queryByText(/A "normal" number\?/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Show me the way")).not.toBeInTheDocument();
  });
});
