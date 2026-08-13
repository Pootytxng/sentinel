import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import Fix from "./Fix";

// POPOUT CONVERGENCE GUARD (2026-08-13).
//
// The app carried THREE popout implementations doing one job: the canonical bento `Sheet`, a
// right-sliding `ActionDrawer` (z 200, blurred scrim, no Escape stand-down for a ConfirmDialog
// above it, a focus trap that counted hidden and disabled controls), and a hand-rolled apply-all
// consent popout inside Fix.tsx (z 120, its own Escape listener, no focus trap, no focus restore).
// Both of the latter were deleted onto the Sheet.
//
// WHY THIS FILE EXISTS. The drawer shipped with NO test of its own, and the consent popout was
// covered only by one text-level assertion in Fix.test.tsx — so "did the conversion drop a control,
// a line of copy, or a handler?" had no mechanical answer. A convergence is exactly the change that
// loses an affordance quietly: the room still renders, tsc is green, and the button that used to be
// in the panel simply is not. This pins the two converted panels at the level the old
// implementations were never pinned at: every section, every control, every handler, INSIDE the one
// canonical `.v2-sheet`.
//
// It deliberately asserts through the Sheet's own DOM (`.v2-sheet`, portalled to <body>) rather
// than the retired `.ad-panel` / `.fix-applyall-modal`. That IS the change being locked in: one
// popout contract for the whole app. The inner class names are unchanged on purpose, so the styles
// and any other matcher kept working — the panel around them is what moved.

type Prov = "verified" | "measured-signal" | "expected-impact";
type Sev = "safe" | "moderate" | "advanced";
const rec = (id: string, provenance: Prov = "verified", severity: Sev = "safe") => ({
  id,
  title: `Title ${id}`,
  description: "desc",
  impact: `impact ${id}`,
  currently_applied: false,
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
  vendor: "any" as const,
};

const sheet = () => document.querySelector(".v2-sheet") as HTMLElement | null;
const backdrop = () => document.querySelector(".v2-sheet-backdrop") as HTMLElement | null;
const sheetClose = () => document.querySelector(".v2-sheet-close") as HTMLButtonElement;

beforeEach(() => {
  localStorage.clear();
  // The "Details ›" affordance is gated on the dashboard-energy preview, which main.tsx sets ON.
  document.documentElement.dataset.dashV2 = "on";
});

afterEach(() => {
  delete document.documentElement.dataset.dashV2;
  delete document.documentElement.dataset.sheet;
});

// ── 1. The per-tweak details panel (was ActionDrawer.tsx) ────────────────────────────────────────
describe("action details: the retired drawer's whole panel, inside the canonical Sheet", () => {
  const openDetails = () => {
    render(<Fix recs={[rec("game-mode")]} {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: "See exactly what this changes" }));
    return sheet()!;
  };

  it("opens as the canonical Sheet — portalled to <body>, modal, and dimming the room behind it", () => {
    const panel = openDetails();
    expect(panel, "the details panel did not open as a .v2-sheet").not.toBeNull();
    expect(document.body.contains(panel)).toBe(true);
    expect(panel.getAttribute("role")).toBe("dialog");
    expect(panel.getAttribute("aria-modal")).toBe("true");
    // The dim flag the retired drawer never set — the room settles back while this is open.
    expect(document.documentElement.dataset.sheet).toBe("open");
  });

  it("keeps EVERY section the drawer had, with its copy and its ad-* classes", () => {
    const panel = openDetails();
    const q = within(panel);
    // The four eyebrows, in the drawer's own words (i18n keys unchanged: optimize.actionDrawer.*).
    expect(q.getByText("What it does")).toBeTruthy();
    expect(q.getByText("What changes on your PC")).toBeTruthy();
    expect(q.getByText("Evidence")).toBeTruthy();
    expect(q.getByText("How it reverts")).toBeTruthy();
    // The honesty payload itself: the REAL apply path and the REAL revert, from rec-mutations.ts.
    expect(q.getByText(/AllowAutoGameMode/)).toBeTruthy();
    expect(q.getByText(/snapshotted first and restored exactly on rollback/)).toBeTruthy();
    // The provenance chip still carries the shared label + honesty note.
    expect(panel.querySelector(".ad-chip")).not.toBeNull();
    expect(panel.querySelectorAll(".ad-block").length).toBeGreaterThanOrEqual(4);
    expect(panel.querySelector(".ad-revert")).not.toBeNull();
  });

  it("the primary action still applies through the same audited path", () => {
    const onToggleRec = vi.fn();
    render(<Fix recs={[rec("game-mode")]} {...baseProps} onToggleRec={onToggleRec} />);
    fireEvent.click(screen.getByRole("button", { name: "See exactly what this changes" }));
    fireEvent.click(within(sheet()!).getByRole("button", { name: "Apply this change" }));
    expect(onToggleRec).toHaveBeenCalledWith("game-mode");
    // Acting closes the panel, exactly as the drawer did.
    expect(sheet()).toBeNull();
  });

  it("an APPLIED change opens the rollback face, and rolls back through onRollback", () => {
    const onRollback = vi.fn();
    const change = {
      id: "c1",
      rec_id: "game-mode",
      rec_title: "Game Mode",
      applied_at: new Date().toISOString(),
      snapshot: null,
      status: "applied" as const,
      is_still_active: true,
      restores_label: "Off",
    };
    render(<Fix recs={[]} {...baseProps} changes={[change]} onRollback={onRollback} view="applied" />);
    fireEvent.click(screen.getByRole("button", { name: "See exactly what this changes" }));
    const q = within(sheet()!);
    expect(q.queryByRole("button", { name: "Apply this change" })).toBeNull();
    // "Currently active — rolls back to: Off." — the applied-only line, still here.
    expect(q.getByText(/Currently active — rolls back to: Off/)).toBeTruthy();
    fireEvent.click(q.getByRole("button", { name: "Roll back" }));
    expect(onRollback).toHaveBeenCalled();
  });

  it("the footer Close survives the conversion (it was a real control, not chrome)", () => {
    const panel = openDetails();
    // Two ways out, as the drawer had: the Sheet's own close AND the footer's.
    expect(panel.querySelector(".ad-secondary")).not.toBeNull();
    fireEvent.click(panel.querySelector(".ad-secondary") as HTMLElement);
    expect(sheet()).toBeNull();
  });

  it("a serial op in flight disables the action — the drawer's busy guard is intact", () => {
    // busyId is a global scalar (the apply model is serial), so ANY op in flight disables this one
    // and swaps its label to the in-flight copy — both behaviours came across unchanged.
    render(<Fix recs={[rec("game-mode")]} {...baseProps} busyId="sysmain-disable" />);
    fireEvent.click(screen.getByRole("button", { name: "See exactly what this changes" }));
    expect(within(sheet()!).getByRole("button", { name: "Applying…" })).toBeDisabled();
  });

  it("GAINED from the Sheet: Escape closes, and focus returns to the row that opened it", () => {
    // The drawer restored focus but its Escape never stood down for a ConfirmDialog above it.
    // Both behaviours are the Sheet's contract now (sheet-contract-guard.test.tsx pins them).
    render(<Fix recs={[rec("game-mode")]} {...baseProps} />);
    const opener = screen.getByRole("button", { name: "See exactly what this changes" });
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(sheetClose());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(sheet()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

// ── 2. The apply-all consent sheet (was the hand-rolled popout in Fix.tsx) ───────────────────────
describe("apply-all consent: the hand-rolled popout, inside the canonical Sheet", () => {
  const two = [rec("game-mode"), rec("sysmain-disable")];

  const openConsent = (props: Record<string, unknown> = {}) => {
    render(<Fix recs={two} {...baseProps} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Apply all safe fixes (2)" }));
    return sheet()!;
  };

  it("opens as the canonical Sheet, named by the same question it always asked", () => {
    const panel = openConsent();
    expect(panel).not.toBeNull();
    expect(panel.getAttribute("role")).toBe("dialog");
    expect(panel.getAttribute("aria-modal")).toBe("true");
    // The accessible name used to come from aria-labelledby on the h3; it is the Sheet's title now.
    expect(panel.getAttribute("aria-label")).toBe("Apply these 2 changes to your rig?");
    expect(within(panel).getByText("Apply these 2 changes to your rig?")).toBeTruthy();
  });

  it("keeps the consent note, the itemised list and both actions, under their own classes", () => {
    const panel = openConsent();
    const q = within(panel);
    expect(q.getByText(/Each is reversible — Compy snapshots the prior state/)).toBeTruthy();
    expect(panel.querySelector(".fix-applyall-note")).not.toBeNull();
    expect(panel.querySelectorAll(".fix-applyall-list .fix-applyall-item").length).toBe(2);
    expect(q.getByText("Title game-mode")).toBeTruthy();
    expect(q.getByText("impact game-mode")).toBeTruthy();
    expect(panel.querySelector(".fix-applyall-cancel")).not.toBeNull();
    expect(panel.querySelector(".fix-applyall-go")).not.toBeNull();
    expect(q.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(q.getByRole("button", { name: "Apply all (2)" })).toBeTruthy();
  });

  it("Cancel closes without applying anything", () => {
    const onApplyBatch = vi.fn().mockResolvedValue({ applied: 0, skipped: [] });
    const panel = openConsent({ onApplyBatch });
    fireEvent.click(within(panel).getByRole("button", { name: "Cancel" }));
    expect(sheet()).toBeNull();
    expect(onApplyBatch).not.toHaveBeenCalled();
  });

  it("Escape closes it while idle (the popout's own Escape rule, kept)", () => {
    openConsent();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(sheet()).toBeNull();
  });

  it("the backdrop closes it while idle (the popout's own click-outside, kept)", () => {
    openConsent();
    fireEvent.click(backdrop()!);
    expect(sheet()).toBeNull();
  });

  it("slim (view='fixes'): the pre-ticked list and per-item deselect still drive the batch", () => {
    const onApplyBatch = vi.fn().mockResolvedValue({ applied: 1, skipped: [] });
    render(<Fix recs={two} {...baseProps} onApplyBatch={onApplyBatch} view="fixes" />);
    fireEvent.click(screen.getByRole("button", { name: "Apply reviewed (2)" }));
    const q = within(sheet()!);
    const tick = q.getByRole("checkbox", { name: "Include Title game-mode" }) as HTMLInputElement;
    expect(tick.checked).toBe(true); // §8c: Recommended arrive ticked
    fireEvent.click(tick);
    // Untick one → the title and the button both count the ticked set, not the whole batch.
    expect(sheet()!.getAttribute("aria-label")).toBe("Apply these 1 changes to your rig?");
    fireEvent.click(q.getByRole("button", { name: "Apply selected (1)" }));
    expect(onApplyBatch).toHaveBeenCalledWith(["sysmain-disable"]);
  });

  // THE ONE BEHAVIOUR THAT MOVED INTO THE SHEET. The retired popout enforced this by hand, twice
  // (a !batching check in its own Escape listener, another in its backdrop onClick). Dismissing the
  // consent panel while the batch is mid-flight would remove the only view of an operation that is
  // still writing to the user's machine — so it became the Sheet's `dismissible` option rather than
  // a reason to keep a second popout implementation.
  it("REFUSES every dismissal while the batch is actually applying", async () => {
    let release: (v: { applied: number; skipped: { title: string; reason: string }[] }) => void = () => {};
    const onApplyBatch = vi.fn(
      () => new Promise<{ applied: number; skipped: { title: string; reason: string }[] }>((r) => (release = r)),
    );
    const panel = openConsent({ onApplyBatch });
    fireEvent.click(within(panel).getByRole("button", { name: "Apply all (2)" }));

    // Mid-apply: the in-flight state is on the button, and NOTHING dismisses the panel.
    expect(within(sheet()!).getByRole("button", { name: "Applying…" })).toBeDisabled();
    expect(within(sheet()!).getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(sheetClose(), "the Sheet's close stayed live during a running batch").toBeDisabled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(sheet(), "Escape dismissed the consent sheet mid-apply").not.toBeNull();
    fireEvent.click(backdrop()!);
    expect(sheet(), "a backdrop click dismissed the consent sheet mid-apply").not.toBeNull();
    fireEvent.click(sheetClose());
    expect(sheet(), "the close button dismissed the consent sheet mid-apply").not.toBeNull();

    // It closes itself when the batch finishes, and reports what actually happened.
    await act(async () => {
      release({ applied: 2, skipped: [] });
    });
    expect(sheet()).toBeNull();
    expect(screen.getByText(/Applied 2/)).toBeTruthy();
  });
});
