import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// The overlay polls sensor commands on mount; mock invoke so it doesn't throw outside Tauri. Data
// resolves to null (handlers catch) — these tests assert STRUCTURE (the flag switch + densities).
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

import Overlay from "./Overlay";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("Overlay", () => {
  it("renders the v2 inverted-rule pill when compy_overlay_v2 is on", () => {
    localStorage.setItem("compy_overlay_v2", "1");
    const { container } = render(<Overlay />);
    expect(container.querySelector(".ovl2")).toBeTruthy();
    expect(screen.getByText("fps")).toBeTruthy(); // the accent unit label
    expect(container.querySelector(".ovl")).toBeFalsy(); // classic not rendered
  });

  it("renders the classic overlay when the flag is off", () => {
    localStorage.setItem("compy_overlay_v2", "0");
    const { container } = render(<Overlay />);
    expect(container.querySelector(".ovl2")).toBeFalsy();
    expect(container.querySelector(".ovl")).toBeTruthy();
  });

  it("minimal density renders FPS only (no metric row, no frametime line)", () => {
    localStorage.setItem("compy_overlay_v2", "1");
    localStorage.setItem("compy_overlay_density", "minimal");
    const { container } = render(<Overlay />);
    expect(container.querySelector(".ovl2-row")).toBeFalsy();
    expect(container.querySelector(".ovl2-ft")).toBeFalsy();
  });

  it("standard density shows the '1% low' / temp / gpu row — and NO cpu (full-only)", () => {
    localStorage.setItem("compy_overlay_v2", "1");
    localStorage.setItem("compy_overlay_density", "standard");
    const { container } = render(<Overlay />);
    expect(container.querySelector(".ovl2-row")).toBeTruthy();
    expect(screen.getByText(/1% low/)).toBeTruthy(); // labeled metric, not a bare "1%"
    expect(screen.queryByText(/cpu/)).toBeNull(); // CPU usage is full-density only
  });

  it("full density adds cpu usage to the row (1% low · temp · cpu · gpu)", () => {
    localStorage.setItem("compy_overlay_v2", "1");
    localStorage.setItem("compy_overlay_density", "full");
    render(<Overlay />);
    expect(screen.getByText(/1% low/)).toBeTruthy();
    expect(screen.getByText(/cpu/)).toBeTruthy(); // usage % only — never CPU temp
    expect(screen.getByText(/gpu/)).toBeTruthy();
  });
});
