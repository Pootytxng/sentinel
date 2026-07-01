import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SlimRecRow, SlimDetailRow } from "./SlimRecRow";

// SlimRecRow primitive (P1 UI slim-down): collapsed = dot · title + proof · badge · one control ·
// chevron, ≤3 interactive affordances; detail expands IN PLACE; the control sits OUTSIDE the
// row-toggle so clicking it never expands/collapses.

const row = (over: Partial<Parameters<typeof SlimRecRow>[0]> = {}) => (
  <ul>
    <SlimRecRow
      title="Turn on Game Mode"
      proof="Verified · Windows focuses on your game · reversible"
      badge="recommended"
      status="attention"
      control={<button>ctl</button>}
      {...over}
    >
      <SlimDetailRow k="Why it matters" v="detail body" />
    </SlimRecRow>
  </ul>
);

describe("SlimRecRow", () => {
  it("collapsed row shows title + the proof line + badge, hides the detail", () => {
    render(row());
    expect(screen.getByText("Turn on Game Mode")).toBeTruthy();
    expect(screen.getByText("Verified · Windows focuses on your game · reversible")).toBeTruthy();
    expect(screen.getByText("Recommended")).toBeTruthy();
    expect(screen.queryByText("detail body")).toBeNull();
  });

  it("collapsed row exposes ≤3 interactive affordances (row-toggle + the one control)", () => {
    const { container } = render(row());
    const tabbables = container.querySelectorAll(
      'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    expect(tabbables.length).toBeLessThanOrEqual(3);
    expect(tabbables.length).toBe(2); // exactly: the whole-row toggle and the control
  });

  it("row click expands the detail in place and flips aria-expanded; second click collapses", () => {
    render(row());
    const toggle = screen.getByRole("button", { name: /Turn on Game Mode/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("detail body")).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryByText("detail body")).toBeNull();
  });

  it("clicking the control does NOT toggle the detail (it sits outside the row-toggle)", () => {
    const onCtl = vi.fn();
    render(row({ control: <button onClick={onCtl}>ctl</button> }));
    fireEvent.click(screen.getByRole("button", { name: "ctl" }));
    expect(onCtl).toHaveBeenCalled();
    expect(screen.queryByText("detail body")).toBeNull();
  });

  it("badge=optional renders the muted Optional badge", () => {
    render(row({ badge: "optional" }));
    expect(screen.getByText("Optional")).toBeTruthy();
  });
});
