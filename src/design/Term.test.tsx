import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Term } from "./Term";
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

  it("reveals the definition on tap and links into the library", () => {
    const open = renderTerm("vrr");
    fireEvent.click(screen.getByRole("button", { name: "VRR" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent(/monitor/i); // vrr 'what' mentions the monitor
    fireEvent.click(screen.getByRole("button", { name: /More in the library/i }));
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
