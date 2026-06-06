import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import Learn from "./Learn";

afterEach(cleanup);

// Behavior parity with the classic Library (TweakEncyclopedia) — same cores, same copy, restyled.
const open = () => render(<Learn onClose={() => {}} />);
const searchBox = () => screen.getByLabelText("Search the knowledge library") as HTMLInputElement;
const title = ".lx-name"; // card titles (the same name can recur as a related chip)

describe("Learn surface (reskin)", () => {
  it("renders the Learn shell with type-filter chips", () => {
    open();
    expect(screen.getByText("Learn")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Terms" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tricks" })).toBeInTheDocument();
  });

  it("search narrows to matching entries (matcher unchanged)", async () => {
    open();
    fireEvent.change(searchBox(), { target: { value: "deep scan" } });
    expect(await screen.findByText("The fake deep scan", { selector: title })).toBeInTheDocument();
  });

  it("keeps the shipped honest empty state for an unknown term", async () => {
    open();
    fireEvent.change(searchBox(), { target: { value: "zxqwv" } });
    expect(await screen.findByText(/No entry for that yet/i)).toBeInTheDocument();
  });

  it("a type filter limits the visible card kinds", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Guides" }));
    expect(screen.getByText("Set up the VRR sync stack", { selector: title })).toBeInTheDocument();
    expect(screen.queryByText("XMP / EXPO memory profile", { selector: title })).not.toBeInTheDocument();
  });

  it("autopsy grades a pasted guide identically and links rows back into the library", () => {
    open();
    fireEvent.click(screen.getByRole("tab", { name: "Autopsy a guide" }));
    fireEvent.change(screen.getByLabelText("Paste a tweak guide to autopsy"), {
      target: { value: "turn on game mode\nforce hpet\nset core parking off\nrun a deep scan\nfrobnicate the doohickey" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Grade this guide" }));
    expect(screen.getByText("1 real")).toBeInTheDocument();
    expect(screen.getByText("1 risky")).toBeInTheDocument();
    expect(screen.getByText("1 placebo")).toBeInTheDocument();
    expect(screen.getByText("1 thing we don't recognize")).toBeInTheDocument();
    expect(screen.getByText(/known scam pattern/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Windows Game Mode/i }));
    expect(screen.getByLabelText("Search the knowledge library")).toBeInTheDocument();
  });
});
