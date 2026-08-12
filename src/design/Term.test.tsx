import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { Term, GlossText, glossSegments, type GlossRule } from "./Term";
import { LibraryContext } from "../surfaces/library-context";

afterEach(cleanup);

const renderTerm = (id: string, openLibrary = vi.fn()) => {
  render(
    <LibraryContext.Provider value={{ openLibrary }}>
      <p>
        Turn on <Term id={id}>VRR</Term> today
      </p>
    </LibraryContext.Provider>,
  );
  return openLibrary;
};

describe("Term glossary tooltip", () => {
  it("renders the trigger as an accessible button", () => {
    renderTerm("vrr");
    expect(screen.getByRole("button", { name: "VRR" })).toBeInTheDocument();
  });

  it("reveals the definition on tap and links into the Blackbook", () => {
    const open = renderTerm("vrr");
    fireEvent.click(screen.getByRole("button", { name: "VRR" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent(/monitor/i); // vrr 'what' mentions the monitor
    fireEvent.click(screen.getByRole("button", { name: /More in History/i }));
    expect(open).toHaveBeenCalledWith("vrr");
  });

  it("fails soft on an unknown id — plain text, no button", () => {
    renderTerm("not-a-real-id");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(/Turn on VRR today/)).toBeInTheDocument(); // children still render, inline
  });

  it("fails soft on a non-term id (a tweak) — plain text, no tooltip", () => {
    render(<Term id="xmp-expo">XMP</Term>); // xmp-expo is a tweak, not a term
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("XMP")).toBeInTheDocument();
  });

  // bug→guard (owner catch 2026-07-13): the tooltip sits 6px below the trigger, and mouse-leave
  // closed it INSTANTLY — the pointer could never cross the gap to click "More in the Blackbook →".
  // The close now rides a short grace timer that re-entering the wrapper (tooltip included) cancels.
  describe("hover grace — the tooltip link is mouse-reachable", () => {
    it("survives a leave→re-enter within the grace (crossing the gap into the tooltip)", () => {
      vi.useFakeTimers();
      try {
        const open = renderTerm("vrr");
        const wrap = screen.getByRole("button", { name: "VRR" }).closest(".kl-term-wrap")!;
        fireEvent.mouseEnter(wrap);
        expect(screen.getByRole("tooltip")).toBeInTheDocument();
        fireEvent.mouseLeave(wrap); // pointer in the 6px gap
        act(() => vi.advanceTimersByTime(80)); // less than the grace
        expect(screen.getByRole("tooltip")).toBeInTheDocument(); // still open mid-crossing
        fireEvent.mouseEnter(wrap); // pointer arrives on the tooltip (a wrapper child)
        act(() => vi.advanceTimersByTime(1000));
        expect(screen.getByRole("tooltip")).toBeInTheDocument(); // pending close was cancelled
        fireEvent.click(screen.getByRole("button", { name: /More in History/i }));
        expect(open).toHaveBeenCalledWith("vrr"); // the link is genuinely reachable + navigates
      } finally {
        vi.useRealTimers();
      }
    });

    it("still closes once the pointer really leaves (grace elapsed)", () => {
      vi.useFakeTimers();
      try {
        renderTerm("vrr");
        const wrap = screen.getByRole("button", { name: "VRR" }).closest(".kl-term-wrap")!;
        fireEvent.mouseEnter(wrap);
        fireEvent.mouseLeave(wrap);
        act(() => vi.advanceTimersByTime(500));
        expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe("glossSegments (curated auto-linker)", () => {
  const rules: GlossRule[] = [
    { id: "vrr", match: ["variable refresh rate", "vrr"] },
    { id: "power-plans", match: ["power plan"] },
  ];

  it("wraps the first matching phrase, preserving original case", () => {
    expect(glossSegments("Enable VRR on your panel", rules)).toEqual([
      "Enable ",
      { id: "vrr", text: "VRR" },
      " on your panel",
    ]);
  });

  it("returns the plain string when nothing matches", () => {
    expect(glossSegments("no jargon in this row", rules)).toEqual(["no jargon in this row"]);
  });

  it("respects word boundaries (no match inside a longer word)", () => {
    expect(glossSegments("a driverless future", [{ id: "drivers", match: ["driver"] }])).toEqual([
      "a driverless future",
    ]);
  });

  it("links only the earliest match (one tooltip per string)", () => {
    const segs = glossSegments("power plan beats raw VRR", rules);
    expect(segs[0]).toEqual({ id: "power-plans", text: "power plan" });
    expect(segs).toHaveLength(2); // matched phrase + trailing remainder; VRR left untouched
  });

  it("GlossText renders the matched phrase as a Term button", () => {
    render(<GlossText text="Turn on VRR for smoothness" rules={rules} />);
    expect(screen.getByRole("button", { name: "VRR" })).toBeInTheDocument();
  });
});
