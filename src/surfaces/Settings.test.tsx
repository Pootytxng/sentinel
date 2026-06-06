import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import Settings from "./Settings";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const baseProps = {
  appVersion: "0.1.0",
  rulesSourceLabel: "Rules: Built-in",
  onBack: vi.fn(),
  canGoBack: false,
  flags: { home: true, fix: true, learn: false, arc: true, settings: true, overlay: true, check: true, play: true, lab: true },
  onSetFlag: vi.fn(),
  onRerunSetup: vi.fn(),
  onRerunCheck: vi.fn(),
  onClose: vi.fn(),
};

describe("Settings", () => {
  it("renders the sections + the honest 'changes pixels only' tagline + privacy line", () => {
    render(<Settings {...baseProps} />);
    expect(screen.getByText("Appearance")).toBeInTheDocument();
    expect(screen.getByText("Behavior")).toBeInTheDocument();
    expect(screen.getByText(/None of this touches what Compy measures/)).toBeInTheDocument();
    expect(screen.getByText(/Fully local\. No account, no telemetry/)).toBeInTheDocument();
    expect(screen.getByText("v0.1.0")).toBeInTheDocument();
  });

  it("step-aside defaults ON; reduced-motion is status-only (never a toggle)", () => {
    render(<Settings {...baseProps} />);
    const stepAside = screen.getByRole("switch", { name: "Step aside when I play" });
    expect(stepAside.getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("switch", { name: /reduced motion/i })).toBeNull();
    expect(screen.getByText(/Follows your Windows setting/)).toBeInTheDocument();
  });

  it("a preview-flag toggle routes through onSetFlag with the right key", () => {
    const onSetFlag = vi.fn();
    render(<Settings {...baseProps} onSetFlag={onSetFlag} />);
    fireEvent.click(screen.getByRole("switch", { name: "New Learn (Library + Autopsy) preview" }));
    expect(onSetFlag).toHaveBeenCalledWith("learn", true); // was false → flips on
  });

  it("Done calls onClose", () => {
    const onClose = vi.fn();
    render(<Settings {...baseProps} onClose={onClose} />);
    fireEvent.click(screen.getByText("Done"));
    expect(onClose).toHaveBeenCalled();
  });
});
