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

// Test's intimidation pass (2026-08-21): six equal-weight station buttons had no "start here" and
// no plain word about when you come to each. Both additions are OPT-IN props so Home's dock, which
// passes neither, renders byte-identically.
describe("Dock — optional orientation (hint caption + primary eyebrow)", () => {
  const hinted = [
    { key: "optimize", name: "Optimize", primary: true, hint: "You just want it faster." },
    { key: "latency", name: "Latency", hint: "Your aim feels a beat behind." },
  ];

  it("without hints or an eyebrow the DOM is exactly the old dock (Home's contract)", () => {
    const { container } = render(<Dock nodes={nodes} activeKey={null} onOpen={() => {}} />);
    expect(container.querySelector(".dock-caption")).toBeNull();
    expect(container.querySelector(".dock-eyebrow")).toBeNull();
    expect(container.querySelector(".dock")!.children.length).toBe(nodes.length);
  });

  it("the caption defaults to the primary's hint, follows the open station, then the hovered one", () => {
    const { container, rerender } = render(<Dock nodes={hinted} activeKey={null} onOpen={() => {}} />);
    const cap = () => container.querySelector(".dock-caption")!.textContent;
    expect(cap()).toBe("Optimize · You just want it faster.");
    rerender(<Dock nodes={hinted} activeKey="latency" onOpen={() => {}} />);
    expect(cap()).toBe("Latency · Your aim feels a beat behind.");
    rerender(<Dock nodes={hinted} activeKey={null} onOpen={() => {}} />);
    fireEvent.pointerEnter(screen.getByRole("button", { name: /latency/i }));
    expect(cap()).toBe("Latency · Your aim feels a beat behind.");
    fireEvent.pointerLeave(screen.getByRole("button", { name: /latency/i }));
    expect(cap()).toBe("Optimize · You just want it faster.");
  });

  it("the eyebrow sits inside the primary node only, and only when passed", () => {
    const { container } = render(
      <Dock nodes={hinted} activeKey={null} onOpen={() => {}} primaryEyebrow="Start here" />,
    );
    const eyebrows = container.querySelectorAll(".dock-eyebrow");
    expect(eyebrows.length).toBe(1);
    expect(eyebrows[0].closest(".dock-node")).toHaveClass("dock-node-primary");
    expect(eyebrows[0].textContent).toBe("Start here");
  });
});
