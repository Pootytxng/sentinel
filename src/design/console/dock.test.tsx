import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
vi.mock("../use-motion", () => ({ useReducedMotion: () => true }));
import { Dock } from "./Dock";

const nodes = [
  { key: "optimize", name: "Optimize", primary: true },
  { key: "bench", name: "Benchmark" },
];

describe("Dock", () => {
  it("renders a button per node and marks the primary", () => {
    render(<Dock nodes={nodes} activeKey={null} onOpen={() => {}} />);
    expect(screen.getByRole("button", { name: /optimize/i })).toHaveClass("dock-node-primary");
    expect(screen.getByRole("button", { name: /benchmark/i })).toBeInTheDocument();
  });
  it("fires onOpen with the node key on click", () => {
    const onOpen = vi.fn();
    render(<Dock nodes={nodes} activeKey={null} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /benchmark/i }));
    expect(onOpen).toHaveBeenCalledWith("bench");
  });
  it("marks reduced-motion so bays render static", () => {
    const { container } = render(<Dock nodes={nodes} activeKey={null} onOpen={() => {}} />);
    expect(container.querySelector(".dock")).toHaveAttribute("data-motion", "reduced");
  });
});
