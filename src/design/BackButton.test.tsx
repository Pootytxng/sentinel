import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BackButton } from "./BackButton";

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
