import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { WhatsThis } from "./WhatsThis";

afterEach(cleanup);

describe("WhatsThis", () => {
  it("reveals a short blurb in place on tap — the trigger no longer navigates away", () => {
    const onOpen = vi.fn();
    // "game-mode" is a real knowledge entry id.
    render(<WhatsThis id="game-mode" onOpen={onOpen} />);
    // Collapsed: the blurb isn't in the tree yet.
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /What's this/i }));
    // The blurb appears in place…
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    // …and the trigger itself never yanks the user out to the Library (the whole point of the change).
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("keeps the full entry one tap away — 'More in the Blackbook' opens the exact entry by id", () => {
    const onOpen = vi.fn();
    render(<WhatsThis id="game-mode" onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /What's this/i }));
    fireEvent.click(screen.getByRole("button", { name: /More in the Blackbook/i }));
    expect(onOpen).toHaveBeenCalledWith("game-mode");
  });

  it("renders NOTHING when no entry resolves by that id (no dead affordance)", () => {
    const { container } = render(<WhatsThis id="not-a-real-entry-xyz" onOpen={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
