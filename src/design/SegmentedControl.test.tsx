import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SegmentedControl } from "./SegmentedControl";

afterEach(cleanup);

const SEGS = [
  { id: "a", label: "Alpha" },
  { id: "b", label: "Beta" },
  { id: "c", label: "Gamma" },
];

describe("SegmentedControl — shared measured-glide control", () => {
  it("renders one tab per segment inside a labelled tablist", () => {
    render(<SegmentedControl segments={SEGS} value="a" onChange={vi.fn()} aria-label="Demo sections" />);
    expect(screen.getByRole("tablist", { name: "Demo sections" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Alpha" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Beta" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Gamma" })).toBeTruthy();
  });

  it("marks the active segment with aria-selected + the contrast-law on-class", () => {
    render(<SegmentedControl segments={SEGS} value="b" onChange={vi.fn()} />);
    const beta = screen.getByRole("tab", { name: "Beta" });
    expect(beta.getAttribute("aria-selected")).toBe("true");
    // The active tab carries seg-btn-on, the hook the CSS uses to put --ix-accent-ink on the
    // --ix-accent pill (contrast law). The others must NOT.
    expect(beta.className).toContain("seg-btn-on");
    expect(screen.getByRole("tab", { name: "Alpha" }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("tab", { name: "Alpha" }).className).not.toContain("seg-btn-on");
  });

  it("fires onChange with the clicked segment id", () => {
    const onChange = vi.fn();
    render(<SegmentedControl segments={SEGS} value="a" onChange={onChange} />);
    fireEvent.click(screen.getByRole("tab", { name: "Gamma" }));
    expect(onChange).toHaveBeenCalledWith("c");
  });

  it("renders the single gliding indicator pill (one accent pill, not one per tab)", () => {
    const { container } = render(<SegmentedControl segments={SEGS} value="a" onChange={vi.fn()} />);
    expect(container.querySelectorAll(".seg-indicator")).toHaveLength(1);
  });
});
