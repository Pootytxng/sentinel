import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
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
    fireEvent.click(screen.getByRole("button", { name: /More in the Blackbook/i }));
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
