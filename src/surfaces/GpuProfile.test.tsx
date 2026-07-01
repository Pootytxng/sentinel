import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { GpuProfile } from "./GpuProfile";
import { GPU_SCOPE_KEY } from "../data/profile-store";
import { type GpuProfileSnapshot } from "../data/gpu-profile-store";

afterEach(() => {
  cleanup();
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

// ── Scope picker (measurement, UI-only) ─────────────────────────────────────────────────────────
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

  it("makes clear the picker is read-only / advisory (changes nothing on Windows)", () => {
    render(<GpuProfile />);
    // Scope the assertion to the picker's own region so the sibling delta card's copy can't confuse it.
    const picker = screen.getByRole("radiogroup").closest("section")!;
    expect(within(picker).getByText(/frames what you look at|changes nothing/i)).toBeTruthy();
  });

  it("uses a radiogroup for the picker", () => {
    render(<GpuProfile />);
    expect(screen.getByRole("radiogroup")).toBeTruthy();
  });
});

// ── Before/after delta (read-only, advisory) ────────────────────────────────────────────────────
const snap = (over: Partial<GpuProfileSnapshot> = {}): GpuProfileSnapshot => ({
  capturedAt: "2026-07-01T00:00:00Z",
  vendor: "AMD",
  model: "Radeon RX 9070 XT",
  driverVersion: "24.6.1",
  hagsEnabled: true,
  powerModeLabel: "Balanced",
  peakTempC: 72,
  ...over,
});

// Visual-honesty guards (bug→guard rule): the card never fabricates a change from a missing read, a
// cooler temp is framed as cooler (no FPS claim), capture is disabled when nothing is readable, and
// the empty/partial states read correctly.
describe("GpuProfile before/after delta", () => {
  it("shows an empty state and disables capture when nothing is readable", () => {
    render(<GpuProfile currentSnapshot={null} />);
    expect(screen.getByText(/No GPU reading is available yet/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Capture before/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("captures before, then after, and renders the delta table", () => {
    const { rerender } = render(<GpuProfile currentSnapshot={snap({ peakTempC: 80 })} />);
    fireEvent.click(screen.getByRole("button", { name: /Capture before/i }));
    expect(screen.getByText(/Make your change, then capture after/i)).toBeTruthy();

    // A change happened in the driver tool: cooler temp + a driver bump.
    rerender(<GpuProfile currentSnapshot={snap({ peakTempC: 68, driverVersion: "24.7.1" })} />);
    fireEvent.click(screen.getByRole("button", { name: /Capture after/i }));

    // Summary counts real changes and frames temp as cooler — never an FPS/perf claim.
    const summary = screen.getByText(/settings changed/i);
    expect(summary.textContent).toMatch(/2 settings changed/);
    expect(summary.textContent).toMatch(/12 °C cooler/);
    expect(summary.textContent).not.toMatch(/fps|faster|performance/i);

    // The driver row shows both values.
    const table = screen.getByRole("table");
    expect(within(table).getByText("24.6.1")).toBeTruthy();
    expect(within(table).getByText("24.7.1")).toBeTruthy();
  });

  it("does NOT count a missing read as a change (honesty)", () => {
    const { rerender } = render(<GpuProfile currentSnapshot={snap({ driverVersion: "24.6.1" })} />);
    fireEvent.click(screen.getByRole("button", { name: /Capture before/i }));
    rerender(<GpuProfile currentSnapshot={snap({ driverVersion: null })} />);
    fireEvent.click(screen.getByRole("button", { name: /Capture after/i }));

    expect(screen.getByText(/No changes between these two snapshots/i)).toBeTruthy();
    const rows = screen.getAllByRole("row");
    const driverRow = rows.find((r) => /Driver version/i.test(r.textContent ?? ""))!;
    expect(driverRow.textContent).toContain("—");
  });

  it("warns of a version-pinned mismatch when the driver changed alongside the temp", () => {
    const { rerender } = render(<GpuProfile currentSnapshot={snap({ peakTempC: 80, driverVersion: "24.6.1" })} />);
    fireEvent.click(screen.getByRole("button", { name: /Capture before/i }));
    // User changed a setting AND their driver moved between snapshots → confounded comparison.
    rerender(<GpuProfile currentSnapshot={snap({ peakTempC: 68, driverVersion: "24.7.1" })} />);
    fireEvent.click(screen.getByRole("button", { name: /Capture after/i }));

    const warn = screen.getByRole("status");
    expect(warn.textContent).toMatch(/driver changed/i);
    expect(warn.textContent).toMatch(/24\.6\.1/);
    expect(warn.textContent).toMatch(/24\.7\.1/);
    // Honesty: the warning never rides an FPS/perf claim.
    expect(warn.textContent).not.toMatch(/fps|faster|performance/i);
  });

  it("does NOT warn of a mismatch when the driver is unchanged (clean comparison)", () => {
    const { rerender } = render(<GpuProfile currentSnapshot={snap({ peakTempC: 80 })} />);
    fireEvent.click(screen.getByRole("button", { name: /Capture before/i }));
    rerender(<GpuProfile currentSnapshot={snap({ peakTempC: 68 })} />);
    fireEvent.click(screen.getByRole("button", { name: /Capture after/i }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does NOT warn of a mismatch when a driver read is missing (never fabricates)", () => {
    const { rerender } = render(<GpuProfile currentSnapshot={snap({ peakTempC: 80, driverVersion: "24.6.1" })} />);
    fireEvent.click(screen.getByRole("button", { name: /Capture before/i }));
    rerender(<GpuProfile currentSnapshot={snap({ peakTempC: 68, driverVersion: null })} />);
    fireEvent.click(screen.getByRole("button", { name: /Capture after/i }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("clear wipes captured snapshots back to the empty prompt", () => {
    render(<GpuProfile currentSnapshot={snap()} />);
    fireEvent.click(screen.getByRole("button", { name: /Capture before/i }));
    fireEvent.click(screen.getByRole("button", { name: /Clear/i }));
    expect(screen.getByText(/Capture a before snapshot to begin/i)).toBeTruthy();
  });
});

// ── A4: vendor-aware advisory badges (read-only) ─────────────────────────────────────────────────
describe("GpuProfile vendor advisory badges", () => {
  it("renders AMD advisory badges from the live snapshot (vendor-aware insights)", () => {
    render(<GpuProfile currentSnapshot={snap({ vendor: "AMD", hagsEnabled: false })} />);
    const region = screen.getByRole("region", { name: /vendor.*(insight|advisor)/i });
    // Named to the AMD tool so it's actionable on THIS rig.
    expect(within(region).getAllByText(/adrenalin/i).length).toBeGreaterThan(0);
    // Honesty: no fabricated FPS/perf promise in the advisory copy.
    expect(region.textContent).not.toMatch(/\bfps\b|faster|guaranteed/i);
  });

  it("shows NO advisory panel for an NVIDIA GPU (vendor-honest — no mis-vendored AMD advice)", () => {
    render(<GpuProfile currentSnapshot={snap({ vendor: "NVIDIA GeForce RTX 4090" })} />);
    expect(screen.queryByRole("region", { name: /vendor.*(insight|advisor)/i })).toBeNull();
  });

  it("shows no advisory panel when there is no live snapshot", () => {
    render(<GpuProfile currentSnapshot={null} />);
    expect(screen.queryByRole("region", { name: /vendor.*(insight|advisor)/i })).toBeNull();
  });
});
