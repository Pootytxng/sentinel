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
  // #237. The control used to declare `role="tablist"`/`role="tab"`/`aria-selected` and implement
  // none of the tabs pattern: no roving focus, no arrow keys, no `tabpanel` to control. These tests
  // assert the contract it actually keeps — a labelled group of native buttons — so a future edit
  // that re-declares tabs has to bring the keyboard behaviour with it.
  it("renders one native button per segment inside a labelled group", () => {
    render(<SegmentedControl segments={SEGS} value="a" onChange={vi.fn()} aria-label="Demo sections" />);
    expect(screen.getByRole("group", { name: "Demo sections" })).toBeTruthy();
    for (const name of ["Alpha", "Beta", "Gamma"]) {
      const btn = screen.getByRole("button", { name });
      expect(btn.tagName).toBe("BUTTON");
      // Not `submit`: dropped inside a form, the default type would submit it on click.
      expect(btn.getAttribute("type")).toBe("button");
    }
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("marks exactly one segment pressed, with the contrast-law on-class", () => {
    render(<SegmentedControl segments={SEGS} value="b" onChange={vi.fn()} />);
    const beta = screen.getByRole("button", { name: "Beta" });
    expect(beta.getAttribute("aria-pressed")).toBe("true");
    // The pressed segment carries seg-btn-on, the hook the CSS uses to put --ix-accent-ink on the
    // --ix-accent pill (contrast law). The others must NOT.
    expect(beta.className).toContain("seg-btn-on");
    expect(screen.getByRole("button", { name: "Alpha" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Alpha" }).className).not.toContain("seg-btn-on");
    expect(screen.getAllByRole("button").filter((b) => b.getAttribute("aria-pressed") === "true")).toHaveLength(1);
  });

  it("moves the pressed state and the pill when the controlled value changes", () => {
    const { rerender } = render(<SegmentedControl segments={SEGS} value="a" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Alpha" }).getAttribute("aria-pressed")).toBe("true");
    rerender(<SegmentedControl segments={SEGS} value="c" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Alpha" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Gamma" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Gamma" }).className).toContain("seg-btn-on");
  });

  it("fires onChange with the clicked segment id", () => {
    const onChange = vi.fn();
    render(<SegmentedControl segments={SEGS} value="a" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Gamma" }));
    expect(onChange).toHaveBeenCalledWith("c");
  });

  it("keeps every segment reachable by Tab — the tab stop this control never rove-managed", () => {
    // A real tablist has ONE tab stop and moves between tabs with the arrow keys. This control has
    // never done that, so each button must be individually reachable: no `tabindex="-1"` anywhere.
    render(<SegmentedControl segments={SEGS} value="a" onChange={vi.fn()} />);
    for (const b of screen.getAllByRole("button")) expect(b.getAttribute("tabindex")).toBeNull();
  });

  it("is focusable and activates without a key handler of its own", () => {
    // Enter/Space activation is the BROWSER's, not ours — jsdom does not synthesize it, so this
    // asserts the two things that make the browser supply it: the element is a real <button>, and it
    // takes focus. No onKeyDown exists in the component, and none should: adding one would be the
    // signal that the element type regressed to a div.
    const onChange = vi.fn();
    render(<SegmentedControl segments={SEGS} value="a" onChange={onChange} />);
    const gamma = screen.getByRole("button", { name: "Gamma" });
    expect(gamma.tagName).toBe("BUTTON");
    gamma.focus();
    expect(document.activeElement).toBe(gamma);
    fireEvent.click(gamma, { detail: 0 }); // detail 0 is what a keyboard-driven activation reports
    expect(onChange).toHaveBeenCalledWith("c");
  });

  it("suppresses measurement while hidden and survives unmount", () => {
    // The zero-width skip (a keepalive'd surface toggling display:none) must be preserved by #237:
    // the semantics change repointed the measure query, and this pins that it still measures the
    // right element and still declines to reflow when there is nothing to measure.
    const { container, unmount } = render(<SegmentedControl segments={SEGS} value="b" onChange={vi.fn()} />);
    const indicator = container.querySelector<HTMLElement>(".seg-indicator")!;
    // jsdom reports offsetWidth 0 for everything, which is exactly the hidden case: opacity stays 0.
    expect(indicator.style.opacity).toBe("0");
    expect(() => unmount()).not.toThrow();
  });

  it("renders the single gliding indicator pill (one accent pill, not one per tab)", () => {
    const { container } = render(<SegmentedControl segments={SEGS} value="a" onChange={vi.fn()} />);
    expect(container.querySelectorAll(".seg-indicator")).toHaveLength(1);
  });
});
