import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrustCue } from "./TrustCue";
import { EmptyState } from "./EmptyState";

describe("TrustCue / EmptyState", () => {
  it("TrustCue shows title + detail", () => {
    render(<TrustCue title="You're protected" detail="4 changes, all reversible." />);
    expect(screen.getByText("You're protected")).toBeInTheDocument();
  });
  it("EmptyState shows its title", () => {
    render(<EmptyState icon="chart" title="No sessions yet" />);
    expect(screen.getByText("No sessions yet")).toBeInTheDocument();
  });
});
