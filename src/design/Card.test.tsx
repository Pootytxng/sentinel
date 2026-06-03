import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card, SectionHeader } from "./Card";

describe("Card / SectionHeader", () => {
  it("renders children and a section title", () => {
    render(<Card><SectionHeader title="Readiness" /></Card>);
    expect(screen.getByText("Readiness")).toBeInTheDocument();
  });
});
