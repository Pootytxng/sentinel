import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import Library from "./TweakEncyclopedia";

afterEach(cleanup); // no global auto-cleanup in this config; unmount between cases

const open = () => render(<Library onClose={() => {}} />);
const searchBox = () => screen.getByLabelText("Search the knowledge library") as HTMLInputElement;

describe("Library surface", () => {
  it("renders the library shell with type-filter chips", () => {
    open();
    expect(screen.getByText("Knowledge library")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Terms" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tricks" })).toBeInTheDocument();
  });

  // Card titles carry class .tweak-name; the same name can also appear as a related chip (a button),
  // so title assertions scope to .tweak-name to target the card, not a chip.
  const title = ".tweak-name";

  it("search narrows to matching entries across types", async () => {
    open();
    fireEvent.change(searchBox(), { target: { value: "deep scan" } });
    expect(await screen.findByText("The fake deep scan", { selector: title })).toBeInTheDocument();
  });

  it("shows the honest empty state for an unknown term", async () => {
    open();
    fireEvent.change(searchBox(), { target: { value: "zxqwv" } });
    expect(await screen.findByText(/No entry for that yet/i)).toBeInTheDocument();
  });

  it("a type filter limits the visible card kinds", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Guides" }));
    expect(screen.getByText("Set up the VRR sync stack", { selector: title })).toBeInTheDocument(); // a guide
    expect(screen.queryByText("XMP / EXPO memory profile", { selector: title })).not.toBeInTheDocument(); // tweak card filtered out
  });

  it("clicking a related chip navigates and clears the search", async () => {
    open();
    fireEvent.change(searchBox(), { target: { value: "expo" } });
    await screen.findByText("XMP / EXPO / DOCP", { selector: title }); // the term card is shown
    const chips = screen.getAllByRole("button", { name: "VRAM (video memory)" }); // a related chip
    fireEvent.click(chips[0]);
    expect(searchBox().value).toBe(""); // navigation cleared the query
  });
});
