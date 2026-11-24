// D6 (owner decision 2026-11-24, plan _train/d6-test-room-opt-in-plan-v2.md, review item 3): with Test's
// Tuning tools off, the palette offers only the stations Test shows then (Diagnostics, Crash & Freeze Rescue),
// never a door to a hidden tool. The rooms (Test included) are unchanged.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CommandPalette } from "./CommandPalette";
import { railFor, type HomeRailItem } from "./homeRail";
import "../i18n";

const QUERIES = ["optimize", "benchmark", "latency", "tuning", "diagnostics", "crash", "prove", "fix"];

/** Every station key the palette can open for these queries: each row is clicked on a fresh mount. */
function stationsReachable(): Set<string> {
  const opened = new Set<string>();
  for (const q of QUERIES) {
    let i = 0;
    for (;;) {
      cleanup();
      const onOpenStation = vi.fn();
      render(
        <CommandPalette
          open
          onClose={() => {}}
          rail={railFor(false, true)}
          railLabel={(item: HomeRailItem) => item.label}
          onNavigate={() => {}}
          onOpenStation={onOpenStation}
          tuningStation
        />,
      );
      fireEvent.change(screen.getByRole("combobox"), { target: { value: q } });
      const rows = screen.queryAllByRole("option");
      if (i >= rows.length) break;
      fireEvent.click(rows[i]);
      for (const [key] of onOpenStation.mock.calls) opened.add(String(key));
      i++;
    }
  }
  cleanup();
  return opened;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.removeItem("compy_tuning_tools");
});

describe("palette stations follow Settings → Tuning tools", () => {
  // Break check: make `keys` ignore `tools` in CommandPalette and benchmark/latency/tuning/optimize return.
  it("with the tools off, opens only Diagnostics and Crash & Freeze Rescue", () => {
    localStorage.setItem("compy_tuning_tools", "0");
    const opened = stationsReachable();
    for (const hidden of ["optimize", "benchmark", "latency", "tuning"]) expect(opened.has(hidden)).toBe(false);
    expect(opened.has("diagnostics")).toBe(true);
    expect(opened.has("blackbox")).toBe(true);
  });

  // Control: the same queries with the tools on reach the tuning stations, so the test above can fail.
  it("with the tools on, the tuning stations are offered as before", () => {
    localStorage.setItem("compy_tuning_tools", "1");
    const opened = stationsReachable();
    for (const shown of ["optimize", "benchmark", "latency", "tuning"]) expect(opened.has(shown)).toBe(true);
  });
});
