import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Dashboard, type DashboardProps } from "./Dashboard";

const base: DashboardProps = {
  readiness: null, priorities: null, changes: [], sessions: [],
  onNavigate: vi.fn(), onExport: vi.fn(),
};

describe("Dashboard", () => {
  it("shows 'Nothing urgent' when there are no limiters", () => {
    render(<Dashboard {...base} />);
    expect(screen.getByText("Nothing urgent")).toBeInTheDocument();
  });
  it("shows the empty session state with no sessions", () => {
    render(<Dashboard {...base} />);
    expect(screen.getByText("No sessions yet")).toBeInTheDocument();
  });
});
