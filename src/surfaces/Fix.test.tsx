import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Fix from "./Fix";

type Prov = "verified" | "measured-signal" | "expected-impact";
const rec = (id: string, applied = false, provenance: Prov = "expected-impact") => ({
  id,
  title: `Title ${id}`,
  description: "desc",
  impact: `impact ${id}`,
  currently_applied: applied,
  provenance,
});

const baseProps = {
  startup: [],
  busyId: null,
  isAppliable: (id: string) => ["game-mode", "sysmain-disable"].includes(id),
  activeChangeFor: () => undefined,
  onToggleRec: vi.fn(),
  onToggleStartup: vi.fn(),
  onOpenLibrary: vi.fn(),
  onDisablePreview: vi.fn(),
};

describe("Fix", () => {
  it("groups recs and shows real header counts", () => {
    const recs = [
      rec("game-mode", false), // appliable, outstanding
      rec("sysmain-disable", true), // appliable, applied
      rec("amd-uxp", false), // not appliable → advisory
    ];
    render(<Fix recs={recs} {...baseProps} />);
    expect(
      screen.getByText(/1 worth your attention · 1 already applied · 3 we'd leave alone/),
    ).toBeTruthy();
    // outstanding appliable rec is visible in Worth fixing
    expect(screen.getByText("Title game-mode")).toBeTruthy();
  });

  it("honest empty state when nothing is worth fixing", () => {
    render(<Fix recs={[rec("game-mode", true)]} {...baseProps} />);
    expect(screen.getByText(/Nothing worth fixing right now/)).toBeTruthy();
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

  it("toggling a worth-fixing switch routes through onToggleRec with the rec id", () => {
    const onToggleRec = vi.fn();
    render(<Fix recs={[rec("game-mode", false)]} {...baseProps} onToggleRec={onToggleRec} />);
    fireEvent.click(screen.getByRole("switch", { name: /Apply Title game-mode/ }));
    expect(onToggleRec).toHaveBeenCalledWith("game-mode");
  });
});
