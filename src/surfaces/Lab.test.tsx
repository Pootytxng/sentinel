import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// Lab + the embedded Benchmark/Latency tabs poll on mount; mock invoke so they don't throw.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

import Lab from "./Lab";

afterEach(cleanup);

describe("Lab", () => {
  it("renders the two instrument sections with plain-English one-liners", () => {
    render(<Lab />);
    expect(screen.getByText("Benchmark")).toBeInTheDocument();
    expect(screen.getByText("Latency")).toBeInTheDocument();
    expect(screen.getByText(/prove it, don't vibe it/)).toBeInTheDocument();
  });

  it("a section expands in place (no route) — navigation never teleports", () => {
    render(<Lab />);
    const benchHeader = screen.getByRole("button", { name: /Benchmark/ });
    expect(benchHeader.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(benchHeader);
    expect(benchHeader.getAttribute("aria-expanded")).toBe("true");
  });
});
