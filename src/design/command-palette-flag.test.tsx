// compy_command_palette — the graduated-flag contract. DEFAULT ON (the feature exists to be found,
// and a discoverability surface that is off by default fixes nothing for the only people it exists
// for); an explicit "0" is the devtools failsafe and must leave the shell exactly as it was before
// the palette: no topbar box, no Ctrl+K binding, no overlay.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ShellV2 } from "./ShellV2";
import { railFor } from "./homeRail";
import { readCommandPalette, applyCommandPalette } from "./theme";

const KEY = "compy_command_palette";

function renderShell() {
  return render(
    <ShellV2
      items={railFor(false, true)}
      activeId="home"
      onNavigate={() => {}}
      ledgerCount={0}
      version="0.0.0"
      onOpenStation={() => {}}
      onOpenEntry={() => {}}
      onOpenSettings={() => {}}
    >
      <div>room</div>
    </ShellV2>,
  );
}

const searchBox = () => screen.queryByText("Search or jump anywhere");

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("the flag reader", () => {
  it("defaults ON when the key was never written", () => {
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(readCommandPalette()).toBe(true);
  });

  it("is OFF only for the literal string \"0\"", () => {
    for (const junk of ["false", "", "no", "OFF", "1"]) {
      localStorage.setItem(KEY, junk);
      expect(readCommandPalette(), junk).toBe(true);
    }
    localStorage.setItem(KEY, "0");
    expect(readCommandPalette()).toBe(false);
  });

  it("applyCommandPalette round-trips and announces the change", () => {
    const heard = vi.fn();
    window.addEventListener("compy:command-palette-changed", heard);
    applyCommandPalette(false);
    expect(readCommandPalette()).toBe(false);
    applyCommandPalette(true);
    expect(readCommandPalette()).toBe(true);
    expect(heard).toHaveBeenCalledTimes(2);
    window.removeEventListener("compy:command-palette-changed", heard);
  });
});

describe("ON (default) — the box is visible, not just a shortcut", () => {
  it("renders the topbar search box with its shortcut hint", () => {
    renderShell();
    // Visible affordance is the POINT: a Ctrl+K-only palette is invisible to exactly the user this
    // was built for — someone who could not find things in the first place.
    expect(searchBox()).toBeTruthy();
    expect(screen.getByText("Ctrl K")).toBeTruthy();
  });

  it("clicking the box opens the palette", () => {
    renderShell();
    fireEvent.click(searchBox()!);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("Ctrl+K opens it from anywhere in the app", () => {
    renderShell();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("Ctrl+K again closes it", () => {
    renderShell();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the rail's digit shortcuts do not fire while the palette is open", () => {
    // Otherwise typing "1" into the search box would ALSO jump a room out from under the overlay.
    const onNavigate = vi.fn();
    render(
      <ShellV2
        items={railFor(false, true)}
        activeId="home"
        onNavigate={onNavigate}
        ledgerCount={0}
        version="0.0.0"
      >
        <div>room</div>
      </ShellV2>,
    );
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.keyDown(window, { key: "2" });
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

describe('OFF ("0") — the pre-palette shell, byte-identical', () => {
  it("renders no search box", () => {
    localStorage.setItem(KEY, "0");
    renderShell();
    expect(searchBox()).toBeNull();
  });

  it("does not bind Ctrl+K", () => {
    localStorage.setItem(KEY, "0");
    renderShell();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("leaves the rail's digit shortcuts working", () => {
    localStorage.setItem(KEY, "0");
    const onNavigate = vi.fn();
    render(
      <ShellV2
        items={railFor(false, true)}
        activeId="home"
        onNavigate={onNavigate}
        ledgerCount={0}
        version="0.0.0"
      >
        <div>room</div>
      </ShellV2>,
    );
    fireEvent.keyDown(window, { key: "2" });
    expect(onNavigate).toHaveBeenCalledWith(railFor(false, true)[1].id);
  });
});
