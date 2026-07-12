import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

// Expert-view render guards (spec 2026-07-11-expert-layer-middle-ground, owner GO 2026-07-12).
// Pins the three §1 behaviors ON THE REAL Fix surface (the same instance the live LabGround →
// OptimizeStation path mounts) plus the GO's added ship condition:
//   1. Default OFF face is untouched — no targets, refused drawer collapsed (byte-identity class).
//   2. ON: the refused drawer renders open with its reasoning inline, no click needed.
//   3. ON: appliable + needs-your-call rows carry the exact target inline — and EVERY rendered
//      target has the one-line rollback-boundary disclaimer beside it (ship condition; a target
//      without its disclaimer is a red test, not a review nit).

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve(null)),
}));

import Fix from "./Fix";
import { setExpertView } from "../design/use-expert-view";
import { EXPERT_TARGET_DISCLAIMER } from "../data/expert-targets";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const rec = (id: string, title: string, over: Record<string, unknown> = {}) => ({
  id,
  title,
  description: "desc",
  impact: "impact",
  currently_applied: false,
  provenance: "verified" as const,
  severity: "safe" as const,
  ...over,
});

// hags-enable = appliable slim row (registry target); vrr-advisory = needs-your-call guided row
// (location target); gpu-driver = advisory with NO mapped target (must render no target line).
const RECS = [
  rec("hags-enable", "Hardware-accelerated GPU scheduling"),
  rec("vrr-advisory", "Check that Variable Refresh Rate is on", { severity: "moderate" }),
  rec("gpu-driver", "Update your GPU driver", { severity: "moderate" }),
];
const APPLIABLE = new Set(["hags-enable"]);

function mountFix() {
  return render(
    <Fix
      recs={RECS}
      startup={[]}
      changes={[]}
      busyId={null}
      isAppliable={(id: string) => APPLIABLE.has(id)}
      activeChangeFor={() => undefined}
      onToggleRec={vi.fn()}
      onToggleStartup={vi.fn()}
      onRollback={vi.fn()}
      onApplyBatch={vi.fn().mockResolvedValue({ applied: 0, skipped: [] })}
      onOpenLibrary={vi.fn()}
      vendor="amd"
      view="fixes"
      v2Ia
      reverted={[]}
    />,
  );
}

describe("Expert view OFF (the default face)", () => {
  it("renders no exact-target lines and no disclaimer anywhere", () => {
    const { container } = mountFix();
    expect(container.querySelectorAll(".fix-expert-path").length).toBe(0);
    expect(screen.queryByText(EXPERT_TARGET_DISCLAIMER)).toBeNull();
  });

  it("keeps the refused drawer collapsed — reasoning stays behind the door", () => {
    mountFix();
    // The section head is there; the pile's items are not rendered until clicked.
    expect(screen.getByText("Deliberately refused")).toBeTruthy();
    expect(screen.queryByText("Force HPET")).toBeNull();
  });
});

describe("Expert view ON (the tinkerer's full panel)", () => {
  it("the refused drawer renders open with each item's reasoning inline — zero clicks", () => {
    localStorage.setItem("compy_expert_view", "1");
    mountFix();
    expect(screen.getByText("Force HPET")).toBeTruthy();
    expect(screen.getByText(/the OS already picks the best timer/)).toBeTruthy();
    expect(screen.getByText("Disable Windows Defender")).toBeTruthy();
    // Still informing, not managing: no apply affordance appears on refused items (LOCKED tier).
    expect(screen.getAllByText("Read the autopsy →").length).toBeGreaterThan(0);
  });

  it("an appliable row shows its exact registry target inline", () => {
    localStorage.setItem("compy_expert_view", "1");
    const { container } = mountFix();
    const paths = [...container.querySelectorAll(".fix-expert-path")].map((n) => n.textContent);
    expect(paths.some((p) => p?.includes("HwSchMode"))).toBe(true);
    expect(paths.some((p) => p?.includes("HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers"))).toBe(true);
  });

  it("a needs-your-call row shows its exact setting location inline", () => {
    localStorage.setItem("compy_expert_view", "1");
    const { container } = mountFix();
    const paths = [...container.querySelectorAll(".fix-expert-path")].map((n) => n.textContent);
    expect(paths.some((p) => p?.includes("Settings → System → Display → Graphics → VRR"))).toBe(true);
  });

  it("SHIP CONDITION: every rendered target carries the rollback-boundary disclaimer beside it", () => {
    localStorage.setItem("compy_expert_view", "1");
    const { container } = mountFix();
    const paths = container.querySelectorAll(".fix-expert-path");
    const notes = container.querySelectorAll(".fix-expert-note");
    expect(paths.length).toBeGreaterThan(0);
    expect(notes.length).toBe(paths.length);
    for (const n of notes) expect(n.textContent).toBe(EXPERT_TARGET_DISCLAIMER);
  });

  it("an unmapped rec renders NO target line (no guessed paths, honesty rail)", () => {
    localStorage.setItem("compy_expert_view", "1");
    const { container } = mountFix();
    const guided = [...container.querySelectorAll(".fix-row-advisory")].find((li) =>
      li.textContent?.includes("Update your GPU driver"),
    );
    expect(guided).toBeTruthy();
    expect(guided!.querySelector(".fix-expert-path")).toBeNull();
  });

  it("flipping the preference live opens the drawer without a remount (Settings toggle path)", () => {
    mountFix();
    expect(screen.queryByText("Force HPET")).toBeNull();
    act(() => setExpertView(true));
    expect(screen.getByText("Force HPET")).toBeTruthy();
    act(() => setExpertView(false));
    expect(screen.queryByText("Force HPET")).toBeNull();
  });
});
