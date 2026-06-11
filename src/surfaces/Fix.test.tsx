import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Fix from "./Fix";

type Prov = "verified" | "measured-signal" | "expected-impact";
type Sev = "safe" | "moderate" | "advanced";
const rec = (id: string, applied = false, provenance: Prov = "expected-impact", severity?: Sev) => ({
  id,
  title: `Title ${id}`,
  description: "desc",
  impact: `impact ${id}`,
  currently_applied: applied,
  provenance,
  severity,
});

const baseProps = {
  startup: [],
  changes: [],
  busyId: null,
  isAppliable: (id: string) => ["game-mode", "sysmain-disable"].includes(id),
  activeChangeFor: () => undefined,
  onToggleRec: vi.fn(),
  onToggleStartup: vi.fn(),
  onRollback: vi.fn(),
  onApplyBatch: vi.fn().mockResolvedValue({ applied: 0, skipped: [] }),
  onOpenLibrary: vi.fn(),
  onDisablePreview: vi.fn(),
  vendor: "any" as const,
};

describe("Fix", () => {
  // Dismissal (§2) persists to localStorage — isolate each test so dismissed state never leaks.
  beforeEach(() => localStorage.clear());

  it("groups recs and shows real header counts", () => {
    const recs = [
      rec("game-mode", false), // appliable, outstanding
      rec("sysmain-disable", true), // appliable, applied
      rec("amd-uxp", false), // not appliable → advisory
    ];
    render(<Fix recs={recs} {...baseProps} />);
    // Honest split (eligibility train): worth-fixing · active · dismissed · not-for-this-rig.
    expect(
      screen.getByText(/1 worth a look · 0 active · 0 dismissed · 0 not for this rig/),
    ).toBeTruthy();
    // outstanding appliable rec is visible in Worth fixing
    expect(screen.getByText("Title game-mode")).toBeTruthy();
  });

  it("§2: 'Not for me' dismisses a rec into the Dismissed strip; restore brings it back", () => {
    const recs = [rec("game-mode", false)];
    render(<Fix recs={recs} {...baseProps} />);
    // The rec is live with a quiet dismiss affordance.
    expect(screen.getByText("Title game-mode")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Not for me" }));
    // It left the active list; subtitle now counts 1 dismissed.
    expect(screen.getByText(/0 worth a look · 0 active · 1 dismissed/)).toBeTruthy();
    // Restore from the (collapsed) Dismissed strip brings it back.
    fireEvent.click(screen.getByText("Dismissed")); // expand the collapsible
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(screen.getByText(/1 worth a look · 0 active · 0 dismissed/)).toBeTruthy();
  });

  it("ledger §2: Active-on-PC shows a deduped active change with a ghost rollback", () => {
    const onRollback = vi.fn();
    const now = new Date().toISOString();
    const ch = (id: string, at: string) => ({
      id,
      rec_id: "game-mode",
      rec_title: "Game Mode",
      applied_at: at,
      snapshot: null,
      status: "applied" as const,
      is_still_active: true,
    });
    // two active entries for the same rec → ONE card (deduped to latest), not two rows.
    render(
      <Fix
        recs={[]}
        {...baseProps}
        changes={[ch("c1", "2026-06-01T10:00:00Z"), ch("c2", now)]}
        onRollback={onRollback}
      />,
    );
    expect(screen.getAllByText("Game Mode")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Roll back/ }));
    expect(onRollback).toHaveBeenCalled();
  });

  it("honest empty state when nothing is worth fixing", () => {
    render(<Fix recs={[rec("game-mode", true)]} {...baseProps} />);
    expect(screen.getByText(/Your rig's already dialed in/)).toBeTruthy();
  });

  it("refuse-pile autopsy links open the correct Library entry", () => {
    const onOpenLibrary = vi.fn();
    render(<Fix recs={[]} {...baseProps} onOpenLibrary={onOpenLibrary} />);
    // refuse-pile is collapsed by default → expand it first
    fireEvent.click(screen.getByText("Not worth touching"));
    const autopsy = screen.getAllByText("Read the autopsy →");
    expect(autopsy).toHaveLength(3);
    fireEvent.click(autopsy[0]);
    expect(onOpenLibrary).toHaveBeenCalledWith("useplatformclock");
  });

  it("§4: 'Apply all safe fixes' lists SAFE-tier items in one consent sheet, then batches them", () => {
    const onApplyBatch = vi.fn().mockResolvedValue({ applied: 2, skipped: [] });
    const recs = [
      rec("game-mode", false, "expected-impact", "safe"), // appliable + safe
      rec("sysmain-disable", false, "expected-impact", "safe"), // appliable + safe
    ];
    render(<Fix recs={recs} {...baseProps} onApplyBatch={onApplyBatch} />);
    // The bar shows the SAFE count and opens the single consent sheet.
    fireEvent.click(screen.getByRole("button", { name: "Apply all safe fixes (2)" }));
    expect(screen.getByText("Apply these 2 changes to your rig?")).toBeTruthy();
    // Approve → the batch runs over exactly those ids (App orchestrates the existing apply per item).
    fireEvent.click(screen.getByRole("button", { name: "Apply all (2)" }));
    expect(onApplyBatch).toHaveBeenCalledWith(["game-mode", "sysmain-disable"]);
  });

  it("§4: moderate-tier appliable recs are NOT swept into 'Apply all safe fixes'", () => {
    const recs = [
      rec("game-mode", false, "expected-impact", "safe"),
      rec("sysmain-disable", false, "expected-impact", "moderate"), // appliable but NOT safe
    ];
    render(<Fix recs={recs} {...baseProps} />);
    // Only ONE safe item → the bar (which needs ≥2) must not appear.
    expect(screen.queryByRole("button", { name: /Apply all safe fixes/ })).toBeNull();
  });

  it("toggling a worth-fixing switch routes through onToggleRec with the rec id", () => {
    const onToggleRec = vi.fn();
    render(<Fix recs={[rec("game-mode", false)]} {...baseProps} onToggleRec={onToggleRec} />);
    fireEvent.click(screen.getByRole("switch", { name: /Apply Title game-mode/ }));
    expect(onToggleRec).toHaveBeenCalledWith("game-mode");
  });
});
