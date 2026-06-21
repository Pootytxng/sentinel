import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// Optimize composes <Check>, which polls real commands on mount via @tauri-apps/api/core. Mock the
// invoke boundary so the scan settles to a tiny, deterministic readiness/priorities result.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_game_readiness")
      return Promise.resolve({
        checks: [{ id: "a", label: "SSD check", status: "ready", detail: "", value: null }],
        ready_count: 1,
        attention_count: 0,
        unknown_count: 0,
        advisory_count: 0,
        advisory: "",
        dismissed_ids: [],
        drifts: [],
      });
    if (cmd === "get_priorities")
      return Promise.resolve({
        limiters: [],
        already_fine: [],
        not_worth_touching: [],
        session_hint: null,
        upgrade_path: null,
      });
    if (cmd === "get_recommendations") return Promise.resolve([]);
    return Promise.resolve(null);
  }),
}));

import { Optimize } from "./Optimize";
import { ConfirmProvider } from "../design/ConfirmDialog";
import type { AppliedChange, Recommendation } from "../types";

afterEach(cleanup);

const rec = (id: string): Recommendation => ({
  id,
  title: `Title ${id}`,
  category: "perf",
  severity: "safe",
  description: "desc",
  impact: `impact ${id}`,
  downside: null,
  applies_to: "all",
  currently_applied: false,
  provenance: "expected-impact",
});

const activeChange: AppliedChange = {
  id: "c1",
  rec_id: "game-mode",
  rec_title: "Game Mode",
  applied_at: new Date().toISOString(),
  snapshot: null,
  status: "applied",
  is_still_active: true,
};

function baseProps(overrides: Partial<React.ComponentProps<typeof Optimize>> = {}) {
  return {
    // Check half
    isAppliable: (id: string) => ["game-mode", "sysmain-disable"].includes(id),
    onOpenLibrary: vi.fn(),
    onChanged: vi.fn(),
    vendor: "any" as const,
    sessions: [],
    gpus: [],
    // Fix half
    recs: [rec("game-mode")],
    startup: [],
    changes: [] as AppliedChange[],
    busyId: null,
    activeChangeFor: () => undefined,
    onToggleRec: vi.fn(),
    onToggleStartup: vi.fn(),
    onRollback: vi.fn(),
    onApplyBatch: vi.fn().mockResolvedValue({ applied: 0, skipped: [] }),
    // shell
    activeCount: 0,
    gamingSlot: null,
    ...overrides,
  };
}

function renderOptimize(overrides = {}) {
  return render(
    <ConfirmProvider>
      <Optimize {...baseProps(overrides)} />
    </ConfirmProvider>,
  );
}

describe("Optimize — segmented shell (phase 1a)", () => {
  it("renders the three segment buttons and defaults to Fixes", () => {
    renderOptimize();
    expect(screen.getByRole("tab", { name: "Fixes" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Applied" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "History" })).toBeTruthy();
    // Fixes is the default — its Check + Fix content is on screen.
    expect(screen.getByText("Check")).toBeTruthy();
    expect(screen.getByText("Worth making for your rig")).toBeTruthy();
  });

  it("clicking 'Applied' shows the ledger and hides the fixes content", () => {
    renderOptimize({ changes: [activeChange] });
    fireEvent.click(screen.getByRole("tab", { name: "Applied" }));
    expect(screen.getByText("Active on this PC")).toBeTruthy();
    // The fixes diagnose surface is no longer mounted in the Applied segment.
    expect(screen.queryByText("Worth making for your rig")).toBeNull();
  });

  it("Applied and History are distinct views — Applied = active layer only, History = full-history layer only", () => {
    renderOptimize({ changes: [activeChange] });
    fireEvent.click(screen.getByRole("tab", { name: "Applied" }));
    expect(screen.getByText("Active on this PC")).toBeTruthy();
    expect(screen.queryByText("Full history")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    expect(screen.getByText("Full history")).toBeTruthy();
    expect(screen.queryByText("Active on this PC")).toBeNull();
  });

  it("the active-undo chip shows the count and is absent at 0", () => {
    const { rerender } = render(
      <ConfirmProvider>
        <Optimize {...baseProps({ activeCount: 0 })} />
      </ConfirmProvider>,
    );
    expect(screen.queryByRole("button", { name: /active · undo/ })).toBeNull();
    rerender(
      <ConfirmProvider>
        <Optimize {...baseProps({ activeCount: 3 })} />
      </ConfirmProvider>,
    );
    expect(screen.getByRole("button", { name: /3 active · undo/ })).toBeTruthy();
  });

  it("clicking the chip selects the Applied segment", () => {
    renderOptimize({ activeCount: 2, changes: [activeChange] });
    fireEvent.click(screen.getByRole("button", { name: /2 active · undo/ }));
    expect(screen.getByText("Active on this PC")).toBeTruthy();
  });

  it("applying a fix (the exposed toggle handler) lands on the Applied segment", () => {
    const onToggleRec = vi.fn();
    renderOptimize({ onToggleRec, changes: [activeChange] });
    // Default segment is Fixes; toggle the worth-fixing switch (an apply).
    fireEvent.click(screen.getByRole("switch", { name: /Apply Title game-mode/ }));
    expect(onToggleRec).toHaveBeenCalledWith("game-mode"); // routed through, unchanged
    // …and the shell lands the panic-user on Applied so undo is one glance away.
    expect(screen.getByText("Active on this PC")).toBeTruthy();
    expect(screen.queryByText("Worth making for your rig")).toBeNull();
  });
});
