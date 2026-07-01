import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { GpuProfile } from "./GpuProfile";
import { GPU_SCOPE_KEY } from "../data/profile-store";

afterEach(() => {
  cleanup();
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe("GpuProfile scope picker", () => {
  it("renders a Global and a Per-game option", () => {
    render(<GpuProfile />);
    expect(screen.getByRole("radio", { name: /global/i })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /per-game/i })).toBeTruthy();
  });

  it("defaults to Global selected", () => {
    render(<GpuProfile />);
    const global = screen.getByRole("radio", { name: /global/i });
    expect(global.getAttribute("aria-checked")).toBe("true");
  });

  it("selecting Per-game marks it checked and persists", () => {
    render(<GpuProfile />);
    const perGame = screen.getByRole("radio", { name: /per-game/i });
    fireEvent.click(perGame);
    expect(perGame.getAttribute("aria-checked")).toBe("true");
    expect(localStorage.getItem(GPU_SCOPE_KEY)).toBe("per-game");
  });

  it("shows the blurb for the active scope", () => {
    localStorage.setItem(GPU_SCOPE_KEY, "per-game");
    render(<GpuProfile />);
    // per-game blurb mentions the current game framing
    expect(screen.getByText(/frames the gpu view around the game/i)).toBeTruthy();
  });

  it("makes clear it is read-only / advisory (changes nothing on Windows)", () => {
    render(<GpuProfile />);
    expect(screen.getByText(/nothing on your pc|read-only|changes nothing|frames/i)).toBeTruthy();
  });

  it("uses a radiogroup for the picker", () => {
    render(<GpuProfile />);
    expect(screen.getByRole("radiogroup")).toBeTruthy();
  });
});
