import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import Learn from "./Learn";

afterEach(cleanup);

// Behavior parity with the classic Library (TweakEncyclopedia) — same cores, same copy, restyled.
const open = () => render(<Learn onClose={() => {}} />);
const searchBox = () => screen.getByLabelText("Search the knowledge library") as HTMLInputElement;
const title = ".lx-name"; // card titles (the same name can recur as a related chip)

describe("Learn surface (reskin)", () => {
  it("renders the Blackbook shell with type-filter chips", () => {
    open();
    expect(screen.getByText("Blackbook")).toBeInTheDocument();
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

  it("§7: pasting a bare YouTube link gets honest coaching — no fetch, grading disabled", () => {
    open();
    fireEvent.click(screen.getByRole("tab", { name: "Autopsy a guide" }));
    fireEvent.change(screen.getByLabelText("Paste a tweak guide to autopsy"), {
      target: { value: "https://www.youtube.com/watch?v=abc123" },
    });
    expect(screen.getByText(/Compy never fetches the internet/i)).toBeInTheDocument();
    expect(screen.getByText(/Show transcript/i)).toBeInTheDocument(); // YouTube-specific path
    const grade = screen.getByRole("button", { name: "Grade this guide" }) as HTMLButtonElement;
    expect(grade.disabled).toBe(true);
  });

  it("§7: a webpage link coaches the copy-the-text path", () => {
    open();
    fireEvent.click(screen.getByRole("tab", { name: "Autopsy a guide" }));
    fireEvent.change(screen.getByLabelText("Paste a tweak guide to autopsy"), {
      target: { value: "https://example.com/best-gaming-tweaks-2026" },
    });
    expect(screen.getByText(/Ctrl\+A, Ctrl\+C/i)).toBeInTheDocument();
  });

  it("§7: a mixed paste (link + real text) still grades the text, ignoring the link", () => {
    open();
    fireEvent.click(screen.getByRole("tab", { name: "Autopsy a guide" }));
    fireEvent.change(screen.getByLabelText("Paste a tweak guide to autopsy"), {
      target: {
        value: "turn on game mode and force hpet from https://example.com to boost fps now please",
      },
    });
    expect(screen.queryByText(/Compy never fetches the internet/i)).not.toBeInTheDocument();
    const grade = screen.getByRole("button", { name: "Grade this guide" }) as HTMLButtonElement;
    expect(grade.disabled).toBe(false);
  });

  it("the AMD undervolt guide is searchable and expands its rich advisory body in place (no apply button)", async () => {
    open();
    fireEvent.change(searchBox(), { target: { value: "undervolt" } });
    const card = (await screen.findByText(/Undervolt your Radeon/i, { selector: title }));
    // Expand the card in place (never teleports) — the foam-pit body is then visible.
    fireEvent.click(card.closest("button")!);
    expect(screen.getByText(/A "normal" number\?/i)).toBeInTheDocument(); // typical range, visible
    expect(screen.getByText(/silicon lottery/i)).toBeInTheDocument();
    expect(screen.getByText(/Discretion:/i)).toBeInTheDocument();
    expect(screen.getByText(/Compy never touches your voltage/i)).toBeInTheDocument();
    expect(screen.getByText(/Undo:/i)).toBeInTheDocument();
    // doorknob: advisory prose — there is nothing to apply (Compy never tunes for you).
    expect(screen.queryByRole("button", { name: /^Apply/i })).not.toBeInTheDocument();
    // "Show me the way" schematic is offered (the walkthrough resolves by the entry id).
    expect(screen.getByText("Show me the way")).toBeInTheDocument();
  });

  it("autopsy grades a guide, expands rows in place, and offers a full-entry link (continuity §3)", () => {
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
    // The sticky context header reports the read-through.
    expect(screen.getByText(/claims? graded/i)).toBeInTheDocument();
    // Clicking a graded row expands IN PLACE — the autopsy stays (paste box remains), no redirect.
    fireEvent.click(screen.getByRole("button", { name: /Windows Game Mode/i }));
    expect(screen.getByText(/Open full entry in Library/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Paste a tweak guide to autopsy")).toBeInTheDocument();
    // The quiet full-entry link is the only deliberate travel into the library.
    fireEvent.click(screen.getByText(/Open full entry in Library/i));
    expect(screen.getByLabelText("Search the knowledge library")).toBeInTheDocument();
  });
});
