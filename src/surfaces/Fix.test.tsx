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
    // outstanding appliable rec is visible in the worth-making section
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

  it("A5 override-all: a 'Restore all' control appears only with 2+ dismissed and brings them ALL back", () => {
    const recs = [rec("game-mode", false), rec("sysmain-disable", false)];
    render(<Fix recs={recs} {...baseProps} />);
    // One dismissed → no bulk control (a single per-row Restore is enough).
    fireEvent.click(screen.getAllByRole("button", { name: "Not for me" })[0]);
    fireEvent.click(screen.getByText("Dismissed"));
    expect(screen.queryByRole("button", { name: /Restore all/ })).toBeNull();
    // Dismiss the second → the bulk control surfaces.
    fireEvent.click(screen.getByRole("button", { name: "Not for me" }));
    expect(screen.getByText(/0 worth a look · 0 active · 2 dismissed/)).toBeTruthy();
    const restoreAll = screen.getByRole("button", { name: /Restore all \(2\)/ });
    fireEvent.click(restoreAll);
    // Both came back; the Dismissed strip is empty again.
    expect(screen.getByText(/2 worth a look · 0 active · 0 dismissed/)).toBeTruthy();
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
    // Voice pass 2026-07-06: the empty line no longer restates the living subtitle's
    // "dialed in" phrase (one phrase, one owner) — it states the fact once.
    expect(screen.getByText(/Nothing waiting — no changes to make/)).toBeTruthy();
    expect(screen.queryByText(/dialed in — nothing here needs/)).toBeNull();
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

  // bug→guard (rollback-correctness, Fix.tsx:973): `busyId` is a single global scalar — the apply/rollback
  // model is SERIAL (one in-flight op). While ANY op is pending, EVERY row's switch must be disabled, not
  // just the matching one; else a user could start a second apply/rollback on a different rec before the
  // first invoke resolves (the UI is interactive again the instant UAC closes) and the second snapshot
  // could capture a prior already mutated by the first — corrupting the rollback chain.
  it("busyId set → EVERY ready-row apply switch is disabled (serial apply/rollback, no concurrent 2nd op)", () => {
    render(
      <Fix
        recs={[rec("game-mode", false), rec("sysmain-disable", false)]}
        {...baseProps}
        busyId="sysmain-disable"
      />,
    );
    // The IN-FLIGHT rec's switch AND every other ready row's switch are disabled.
    expect(screen.getByRole("switch", { name: /Apply Title sysmain-disable/ })).toBeDisabled();
    expect(screen.getByRole("switch", { name: /Apply Title game-mode/ })).toBeDisabled();
  });

  it("busyId null → ready-row switches are enabled (no op in flight)", () => {
    render(<Fix recs={[rec("game-mode", false)]} {...baseProps} busyId={null} />);
    expect(screen.getByRole("switch", { name: /Apply Title game-mode/ })).not.toBeDisabled();
  });

  // ── view prop (Optimize merge phase 1a, spec 2026-06-21): render fixes-only or ledger-only ──
  // An active change drives the ledger sections; a worth-fixing rec drives the fixes sections.
  const activeChange = {
    id: "c1",
    rec_id: "game-mode",
    rec_title: "Game Mode",
    applied_at: new Date().toISOString(),
    snapshot: null,
    status: "applied" as const,
    is_still_active: true,
  };

  it('default view ("all") renders BOTH the fixes sections and the ledger sections (byte-identical Tune)', () => {
    render(<Fix recs={[rec("game-mode", false)]} {...baseProps} changes={[activeChange]} />);
    expect(screen.getByText("Worth making for your rig")).toBeTruthy();
    expect(screen.getByText("Active on this PC")).toBeTruthy();
    expect(screen.getByText("History")).toBeTruthy();
  });

  it('view="fixes" renders the fixes sections and NONE of the ledger sections', () => {
    render(<Fix recs={[rec("game-mode", false)]} {...baseProps} changes={[activeChange]} view="fixes" />);
    expect(screen.getByText("Worth making for your rig")).toBeTruthy();
    expect(screen.queryByText("Active on this PC")).toBeNull();
    expect(screen.queryByText("History")).toBeNull();
  });

  it('view="ledger" renders the ledger sections and NONE of the fixes sections', () => {
    render(<Fix recs={[rec("game-mode", false)]} {...baseProps} changes={[activeChange]} view="ledger" />);
    expect(screen.getByText("Active on this PC")).toBeTruthy();
    expect(screen.getByText("History")).toBeTruthy();
    expect(screen.queryByText("Worth making for your rig")).toBeNull();
    // Startup + refuse-pile + guided are fixes-side too — gone in ledger view.
    expect(screen.queryByText("Not worth touching")).toBeNull();
  });

  // Active/History split (Optimize merge phase 1c-pulled-forward): the Applied segment shows ONLY the
  // active layer, the History segment shows ONLY the full-history layer — so the third segment is a
  // distinct view, not a no-op mirror of the second.
  it('view="applied" renders the active layer ONLY (no full history, no fixes)', () => {
    render(<Fix recs={[rec("game-mode", false)]} {...baseProps} changes={[activeChange]} view="applied" />);
    expect(screen.getByText("Active on this PC")).toBeTruthy();
    expect(screen.queryByText("History")).toBeNull();
    expect(screen.queryByText("Worth making for your rig")).toBeNull();
  });

  // bug→guard (V2 nits pass, spec 2026-07-05): a no-op receipt (prior == after) must NOT render a
  // change arrow — it says "Already <state> — no change needed" on both the collapsed active card
  // and the expanded history receipt. Real states keep the arrow.
  it("no-op receipt (restores_label === applied_label) drops the arrow for honest no-change copy", () => {
    const noop = {
      ...activeChange,
      restores_label: "Disabled",
      applied_label: "Disabled",
    };
    render(<Fix recs={[]} {...baseProps} changes={[noop]} />);
    // Collapsed active card: no-change copy, no arrow anywhere.
    expect(screen.getByText(/Already Disabled — no change needed/)).toBeTruthy();
    expect(screen.queryByText(/→/)).toBeNull();
    // Expanded history receipt: same honesty. History is collapsed — open it, then the row.
    fireEvent.click(screen.getByText("History"));
    fireEvent.click(screen.getByRole("button", { name: /Game Mode/ }));
    expect(screen.getAllByText(/no change needed/).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/Before/)).toBeNull();
  });

  it("a real change (restores_label !== applied_label) keeps the → arrow", () => {
    const real = {
      ...activeChange,
      restores_label: "Enabled",
      applied_label: "Disabled",
    };
    render(<Fix recs={[]} {...baseProps} changes={[real]} />);
    expect(screen.getByText(/Enabled → Disabled/)).toBeTruthy();
    expect(screen.queryByText(/no change needed/)).toBeNull();
  });

  it('view="history" renders the full-history layer ONLY (no active layer, no fixes)', () => {
    render(<Fix recs={[rec("game-mode", false)]} {...baseProps} changes={[activeChange]} view="history" />);
    expect(screen.getByText("History")).toBeTruthy();
    expect(screen.queryByText("Active on this PC")).toBeNull();
    expect(screen.queryByText("Worth making for your rig")).toBeNull();
  });

  // ── A5 rig tagging: "this rig only" filter + "last seen working on" hardware tag ──
  const oldRig = { hash: "aa", gpu: "GTX 1070", gpu_driver: "512.1", ram_gb: 16, display: "1920x1080@60" };
  const histEntry = (id: string, extra: Record<string, unknown>) => ({
    id,
    rec_id: id,
    rec_title: `Change ${id}`,
    applied_at: "2026-06-01T10:00:00Z",
    snapshot: null,
    status: "rolled_back" as const,
    is_still_active: false,
    ...extra,
  });

  it("A5 rig filter: hides exactly the known-other-rig entries; legacy unstamped rows always stay", () => {
    const changes = [
      histEntry("stamped-other", { on_this_rig: false, hw_fingerprint: oldRig }),
      histEntry("stamped-here", { on_this_rig: true, hw_fingerprint: { ...oldRig, gpu: "RX 9070 XT" } }),
      histEntry("legacy", {}), // pre-tagging entry: no stamp → must NEVER be hidden
    ];
    render(<Fix recs={[]} {...baseProps} changes={changes} view="history" />);
    fireEvent.click(screen.getByText("History"));
    expect(screen.getByText("Change stamped-other")).toBeTruthy();
    expect(screen.getByText("Change legacy")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /This rig only/ }));
    expect(screen.queryByText("Change stamped-other")).toBeNull();
    expect(screen.getByText("Change stamped-here")).toBeTruthy();
    expect(screen.getByText("Change legacy")).toBeTruthy();
    expect(screen.getByText(/1 from other hardware hidden/)).toBeTruthy();
  });

  it("A5 rig filter: no toggle at all when nothing is from other hardware (no dead control)", () => {
    const changes = [histEntry("stamped-here", { on_this_rig: true, hw_fingerprint: oldRig })];
    render(<Fix recs={[]} {...baseProps} changes={changes} view="history" />);
    fireEvent.click(screen.getByText("History"));
    expect(screen.queryByRole("checkbox", { name: /This rig only/ })).toBeNull();
  });

  it("A5 hardware tag: an other-rig history receipt names the rig it was last seen working on", () => {
    const changes = [histEntry("stamped-other", { on_this_rig: false, hw_fingerprint: oldRig })];
    render(<Fix recs={[]} {...baseProps} changes={changes} view="history" />);
    fireEvent.click(screen.getByText("History"));
    expect(screen.getByText("other rig")).toBeTruthy(); // the row tag
    fireEvent.click(screen.getByText("Change stamped-other")); // expand the receipt
    expect(screen.getByText(/Last seen working on/)).toBeTruthy();
    expect(screen.getByText(/GTX 1070 · 16 GB RAM/)).toBeTruthy();
  });

  it("A5 hardware tag: an ACTIVE change from other hardware gets the quiet heads-up card line", () => {
    const ch = {
      ...activeChange,
      on_this_rig: false,
      hw_fingerprint: oldRig,
    };
    render(<Fix recs={[]} {...baseProps} changes={[ch]} view="applied" />);
    expect(screen.getByText(/Last seen working on/)).toBeTruthy();
    expect(screen.getByText(/GTX 1070 · 16 GB RAM/)).toBeTruthy();
    // Honest scope: a same-rig active change shows NO such line.
    localStorage.clear();
  });

  // ── A5 applicability override: "My hardware supports this" on capability-gated recs ──
  it("A5 override: an ineligible rec can be overridden into the live flow, reversibly", () => {
    const ineligibleRec = {
      ...rec("game-mode", false),
      eligible: false,
      ineligible_reason: "No wired Ethernet port detected.",
    };
    render(<Fix recs={[ineligibleRec]} {...baseProps} />);
    // Starts set aside: counted as not-for-this-rig, not worth-a-look; no switch offered.
    expect(screen.getByText(/0 worth a look · 0 active · 0 dismissed · 1 not for this rig/)).toBeTruthy();
    expect(screen.queryByRole("switch", { name: /Apply Title game-mode/ })).toBeNull();
    // Override from the pile → it rejoins the normal flow with the REAL switch.
    fireEvent.click(screen.getByText("Not for this rig"));
    expect(screen.getByText("No wired Ethernet port detected.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /My hardware supports this/ }));
    expect(screen.getByText(/1 worth a look · 0 active · 0 dismissed · 0 not for this rig/)).toBeTruthy();
    expect(screen.getByRole("switch", { name: /Apply Title game-mode/ })).toBeTruthy();
    // The pile keeps the decision on record — marker + the original read + the way back.
    expect(screen.getByText("overridden by you")).toBeTruthy();
    expect(screen.getByText(/Compy's read was/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Set aside again" }));
    expect(screen.getByText(/0 worth a look · 0 active · 0 dismissed · 1 not for this rig/)).toBeTruthy();
    expect(screen.queryByRole("switch", { name: /Apply Title game-mode/ })).toBeNull();
  });

  it("A5 hardware tag: legacy entries (no stamp) render no rig line and no tag — never a guess", () => {
    const changes = [histEntry("legacy", {})];
    render(<Fix recs={[]} {...baseProps} changes={changes} view="history" />);
    fireEvent.click(screen.getByText("History"));
    expect(screen.queryByText("other rig")).toBeNull();
    fireEvent.click(screen.getByText("Change legacy"));
    expect(screen.queryByText(/Applied on|Last seen working on/)).toBeNull();
  });
});

// Advisory "Needs your call" cards are DOORS (tester J 2026-07-22: clicked the card, nothing
// happened, concluded the section was dead). Regression guard for the 0.9.6/0.9.7 fix + the
// 0.9.7 honesty correction (an opened card ALWAYS answers — never a dead open).
describe("Fix advisory cards behave as doors", () => {
  beforeEach(() => localStorage.clear());

  // The advisory GuidedRows live inside the "Compy points the way" collapsible; open it first
  // (in the live Lab it renders expanded, but the isolated Fix render starts collapsed).
  const openAdvisory = (container: HTMLElement) => {
    if (container.querySelector("button.fix-advisory-door")) return;
    const head = screen.queryByText(/Compy points the way/);
    if (head) fireEvent.click(head);
  };

  it("the card head toggles a detail; a no-guide advisory still answers honestly on open", () => {
    // nvidia-telemetry is not appliable (baseProps.isAppliable) and has no GUIDED_STEPS entry →
    // advisory, no guide (amd-uxp does carry a guide, so it would hit the guided branch instead).
    const { container } = render(<Fix recs={[rec("nvidia-telemetry", false)]} {...baseProps} />);
    openAdvisory(container);
    const door = container.querySelector("button.fix-advisory-door") as HTMLElement;
    expect(door).toBeTruthy();
    expect(door.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".fix-guided-detail")).toBeNull();
    fireEvent.click(door);
    expect(door.getAttribute("aria-expanded")).toBe("true");
    // Opened: ALWAYS answers. With no guide, the honest no-switch copy renders (not a dead open).
    expect(container.querySelector(".fix-guided-detail")).toBeTruthy();
    expect(container.querySelector(".fix-guided-none")).toBeTruthy();
    // Quick actions carry a real (bordered) Not-for-me button in a visible row.
    const quick = container.querySelector(".fix-advisory-quickacts") as HTMLElement;
    expect(quick).toBeTruthy();
    expect(quick.querySelector(".fix-dismiss")).toBeTruthy();
  });

  it("a guided advisory opens its steps, not the no-switch fallback", () => {
    // audio-enhancements-advisory is not appliable AND has a GUIDED_STEPS entry → advisory + guide.
    const { container } = render(
      <Fix recs={[rec("audio-enhancements-advisory", false)]} {...baseProps} />,
    );
    openAdvisory(container);
    const door = container.querySelector("button.fix-advisory-door") as HTMLElement;
    expect(door).toBeTruthy();
    // The guided "How to ->" affordance exists for a guided advisory.
    expect(container.querySelector(".fix-guided-actions")).toBeTruthy();
    fireEvent.click(door);
    // Opened a guided card: real detail, never the no-switch fallback.
    expect(container.querySelector(".fix-guided-detail")).toBeTruthy();
    expect(container.querySelector(".fix-guided-none")).toBeNull();
  });
});
