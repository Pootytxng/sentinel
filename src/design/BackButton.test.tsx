import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BackButton, ForwardButton } from "./BackButton";

describe("BackButton", () => {
  it("is visible but DISABLED when there's nowhere to go back (24/7, disabled-not-hidden)", () => {
    render(<BackButton onBack={vi.fn()} canGoBack={false} />);
    const btn = screen.getByRole("button", { name: "Back" });
    expect(btn).toBeInTheDocument();
    expect(btn).toBeDisabled();
  });

  it("is enabled + fires onBack when there's history", () => {
    const onBack = vi.fn();
    render(<BackButton onBack={onBack} canGoBack />);
    const btn = screen.getByRole("button", { name: "Back" });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe("ForwardButton", () => {
  it("is visible but DISABLED when there's nothing to re-walk (24/7, disabled-not-hidden)", () => {
    render(<ForwardButton onForward={vi.fn()} canGoForward={false} />);
    const btn = screen.getByRole("button", { name: "Forward" });
    expect(btn).toBeInTheDocument();
    expect(btn).toBeDisabled();
  });

  it("is enabled + fires onForward after a back-move banked a location", () => {
    const onForward = vi.fn();
    render(<ForwardButton onForward={onForward} canGoForward />);
    const btn = screen.getByRole("button", { name: "Forward" });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onForward).toHaveBeenCalledTimes(1);
  });
});
