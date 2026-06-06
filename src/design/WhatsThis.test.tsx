import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WhatsThis } from "./WhatsThis";

describe("WhatsThis", () => {
  it("renders + opens the exact entry by id when one resolves", () => {
    const onOpen = vi.fn();
    // "game-mode" is a real tweaks.json entry id.
    render(<WhatsThis id="game-mode" onOpen={onOpen} />);
    const btn = screen.getByRole("button", { name: /What's this/i });
    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalledWith("game-mode");
  });

  it("renders NOTHING when no entry resolves by that id (no dead link)", () => {
    const { container } = render(<WhatsThis id="not-a-real-entry-xyz" onOpen={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
