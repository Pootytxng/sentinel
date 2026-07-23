import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";

// §C: the build stamp arrives over the existing IPC probe pattern; everything else resolves null
// (ReceiptsConsent stays dark, toggles no-op) — same graceful paths as the no-mock days.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_build_stamp") return Promise.resolve("ab12cd3 · dev");
    if (cmd === "get_receipts_gate") return Promise.resolve(false);
    return Promise.resolve(null);
  }),
}));

import Settings from "./Settings";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const baseProps = {
  appVersion: "0.1.0",
  rulesSourceLabel: "Rules: Built-in",
  onBack: vi.fn(),
  canGoBack: false,
  onForward: vi.fn(),
  canGoForward: false,
  onRerunSetup: vi.fn(),
  onClose: vi.fn(),
};

describe("Settings", () => {
  it("renders the sections + the honest 'changes pixels only' tagline + privacy line", () => {
    render(<Settings {...baseProps} />);
    expect(screen.getByText("Appearance")).toBeInTheDocument();
    expect(screen.getByText("Behavior")).toBeInTheDocument();
    expect(screen.getByText(/None of this touches what Compy measures/)).toBeInTheDocument();
    expect(screen.getByText(/Local-first: no telemetry, no account/i)).toBeInTheDocument();
    expect(screen.getByText(/signed updates/i)).toBeInTheDocument();
    expect(screen.getByText("v0.1.0")).toBeInTheDocument();
  });

  it("Motion is a Full/System/Reduced control (default Full, overrides OS)", () => {
    render(<Settings {...baseProps} />);
    const motion = screen.getByRole("group", { name: "Motion" });
    expect(motion).toBeInTheDocument();
    const full = within(motion).getByRole("button", { name: "Full" });
    expect(full.getAttribute("aria-pressed")).toBe("true");
    expect(within(motion).getByRole("button", { name: "Follow system" })).toBeInTheDocument();
    expect(within(motion).getByRole("button", { name: "Reduced" })).toBeInTheDocument();
    expect(screen.getByText(/living motion is on by default/i)).toBeInTheDocument();
  });

  it("Expert view is a genuine preference — present, default OFF, persists on toggle", () => {
    render(<Settings {...baseProps} />);
    const toggle = screen.getByRole("switch", { name: "Expert view" });
    // Default OFF: the default face stays the recovering-skeptic's simple one (spec 2026-07-11).
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    // Honest copy: says what it reveals AND that nothing new becomes appliable.
    expect(screen.getByText(/nothing new becomes appliable/)).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(localStorage.getItem("compy_expert_view")).toBe("1");
    fireEvent.click(toggle);
    expect(localStorage.getItem("compy_expert_view")).toBe("0");
  });

  it("Done calls onClose", () => {
    const onClose = vi.fn();
    render(<Settings {...baseProps} onClose={onClose} />);
    fireEvent.click(screen.getByText("Done"));
    expect(onClose).toHaveBeenCalled();
  });

  it("§C: About carries the compile-time build stamp (review hygiene / receipts-for-builds)", async () => {
    render(<Settings {...baseProps} />);
    expect(await screen.findByText(/ab12cd3 · dev/)).toBeInTheDocument();
  });
});
