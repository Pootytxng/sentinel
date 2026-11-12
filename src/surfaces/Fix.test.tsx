import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Fix from "./Fix";
import { LEDGER_CHANGED_EVENT, type AppliedChange } from "../types";

// Outside Tauri the real invoke rejects; the default here does the same, so the tests that never
// touch the backend behave exactly as before. The #619 tests below give it the one command they use.
const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(
    (_cmd: string, _args?: unknown): Promise<unknown> => Promise.reject(new Error("no Tauri in tests")),
  ),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

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
      active_check: "on" as const,
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

  it("CR-footer-reversible: a live change whose record resolves to no undo says so and its Roll back can't run", () => {
    const onRollback = vi.fn();
    render(
      <Fix
        recs={[]}
        {...baseProps}
        changes={[
          {
            id: "c9",
            rec_id: "game-mode",
            rec_title: "Game Mode",
            applied_at: new Date().toISOString(),
            snapshot: null,
            status: "applied",
            is_still_active: true,
            active_check: "on",
            undo_contract: false,
          },
        ]}
        onRollback={onRollback}
      />,
    );
    expect(screen.getByText("Compy has no saved undo for this change.")).toBeTruthy();
    const button = screen.getByRole("button", { name: /Roll back/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onRollback).not.toHaveBeenCalled();
  });

  it("CR-hist-today: just after midnight, History calls the previous morning's rows yesterday", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 10, 12, 0, 35) });
    try {
      const row = (id: string, h: number, m: number) => ({
        id,
        rec_id: `rec-${id}`,
        rec_title: `Row ${id}`,
        applied_at: new Date(2026, 10, 11, h, m).toISOString(),
        snapshot: null,
        status: "rolled_back" as const,
        is_still_active: false,
      });
      const { container } = render(
        <Fix recs={[]} {...baseProps} view="history" changes={[row("a", 6, 14), row("b", 4, 19)]} />,
      );
      fireEvent.click(screen.getByText("History"));
      const whens = [...container.querySelectorAll(".fix-hist-when")].map((e) => e.textContent ?? "");
      expect(whens).toHaveLength(2);
      for (const w of whens) expect(w).toMatch(/^yesterday · /);
    } finally {
      vi.useRealTimers();
    }
  });

  it("CR-outside-followups (b): a row recorded as changed outside Compy says so in History, not 'rolled back'", () => {
    const row = (id: string, rec: string, title: string, outside: boolean) => ({
      id,
      rec_id: rec,
      rec_title: title,
      applied_at: "2026-09-26T03:11:32.377+00:00",
      snapshot: null,
      status: "applied" as const,
      is_still_active: false,
      active_check: "off" as const,
      ...(outside
        ? {
            changed_outside: {
              schema: 1,
              recorded_at: "2026-11-10T20:00:00+00:00",
              observed: { kind: "power-plan", guid: "22222222-2222-2222-2222-222222222222", name: "Synez Power Plan" },
            },
            changed_outside_holds: true,
          }
        : {}),
    });
    const { container } = render(
      <Fix
        recs={[]}
        {...baseProps}
        view="ledger"
        changes={[
          row("p1", "power-ultimate", "Switch to the Ultimate Performance power plan", true),
          row("g1", "game-mode", "Game Mode", false),
          // A schema this build doesn't know is no record: it reads as before.
          { ...row("v1", "visual-effects", "Visual effects", true), changed_outside: { schema: 2, recorded_at: "x", observed: { kind: "power-plan", name: "Y" } } },
          // The plan moved on to a third one: the record no longer holds, as Game Readiness reads it.
          { ...row("m1", "power-moved", "Moved plan", true), changed_outside_holds: false },
          // Switched back to Compy's plan: on again, so active, not "changed outside".
          { ...row("b1", "power-back", "Back on", true), is_still_active: true, active_check: "on" as const },
          // An undo is still "rolled back".
          { ...row("r1", "hags-enable", "Undone one", false), status: "rolled_back" as const },
        ]}
      />,
    );
    fireEvent.click(screen.getByText("History"));
    const status = (title: string) =>
      [...container.querySelectorAll(".fix-hist-row")]
        .find((r) => r.querySelector(".fix-hist-title")?.textContent === title)
        ?.querySelector(".fix-hist-status")?.textContent;
    expect(status("Switch to the Ultimate Performance power plan")).toBe("changed outside Compy");
    // CR-kept-outside-nits (c): applied rows that read off were never undone: "off now", not "rolled back".
    expect(status("Game Mode")).toBe("off now, not undone");
    expect(status("Visual effects")).toBe("off now, not undone");
    expect(status("Moved plan")).toBe("off now, not undone");
    expect(status("Back on")).toBe("active");
    expect(status("Undone one")).toBe("✓ rolled back");
    fireEvent.click(screen.getByText("Switch to the Ultimate Performance power plan"));
    expect(screen.getByTestId("fix-hist-kept-outside").textContent).toMatch(/to keep “Synez Power Plan”, which was set outside Compy/);
  });

  // #638 (PR #634 follow-on): the legacy `is_still_active` stays true when the live re-check could
  // not read the machine. History and Health say "can't confirm" for such a change; Optimize used to
  // list it under "Active on this PC". It now sits under its own heading, rollback intact.
  it("#638: a change Compy cannot read is not listed as active on this PC, and keeps its rollback", () => {
    const onRollback = vi.fn();
    const at = new Date().toISOString();
    const ch = (id: string, rec: string, title: string, check: "on" | "unreadable" | "unrecognised") => ({
      id,
      rec_id: rec,
      rec_title: title,
      applied_at: at,
      snapshot: null,
      status: "applied" as const,
      is_still_active: true,
      active_check: check,
    });
    const { container } = render(
      <Fix
        recs={[]}
        {...baseProps}
        view="applied"
        changes={[
          ch("c1", "game-mode", "Game Mode", "on"),
          ch("c2", "hpet", "HPET off", "unreadable"),
          ch("c3", "nagle", "Nagle off", "unrecognised"),
        ]}
        onRollback={onRollback}
      />,
    );
    const labels = [...container.querySelectorAll(".fix-section-label")].map((n) => n.textContent);
    expect(labels).toContain("Active on this PC");
    expect(labels).toContain("Applied — Compy can't confirm these are still on");
    // each heading is followed by its own list; the "active" list holds only the change read as on
    const lists = [...container.querySelectorAll(".fix-section-label + .fix-list")];
    const listUnder = (label: string) => lists[labels.indexOf(label)]?.textContent ?? "";
    expect(listUnder("Active on this PC")).toContain("Game Mode");
    expect(listUnder("Active on this PC")).not.toContain("HPET off");
    expect(listUnder("Active on this PC")).not.toContain("Nagle off");
    expect(listUnder("Applied — Compy can't confirm these are still on")).toContain("HPET off");
    expect(listUnder("Applied — Compy can't confirm these are still on")).toContain("Nagle off");
    expect(listUnder("Applied — Compy can't confirm these are still on")).not.toMatch(/Active since/);
    // a rollback is never hidden: all three cards keep theirs
    expect(screen.getAllByRole("button", { name: /Roll back/ })).toHaveLength(3);
  });

  it("#638: with only unreadable changes, nothing claims 'active' and the empty line stays away", () => {
    const { container } = render(
      <Fix
        recs={[]}
        {...baseProps}
        view="applied"
        changes={[
          {
            id: "c2",
            rec_id: "hpet",
            rec_title: "HPET off",
            applied_at: new Date().toISOString(),
            snapshot: null,
            status: "applied" as const,
            is_still_active: true,
            active_check: "unreadable" as const,
          },
        ]}
      />,
    );
    const labels = [...container.querySelectorAll(".fix-section-label")].map((n) => n.textContent);
    expect(labels).not.toContain("Active on this PC");
    expect(screen.queryByText(/Nothing active on this PC/)).toBeNull();
    expect(screen.getByRole("button", { name: /Roll back/ })).toBeTruthy();
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
    // The live re-check read it on. The wire always carries this field (#453: "active on this PC"
    // is the live read, never the legacy bool on its own).
    active_check: "on" as const,
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

  // P5-outcomes-f1: a row made from the Trial bench's outcome switch names the Trial behind it.
  it("an outcome-switch row says which Trial it was applied and undone because of; other rows say nothing", () => {
    const changes = [
      histEntry("switched", {
        justified_by_experiment: { experiment_id: "exp:max", outcome: "max-fps", concluded_at: "2026-06-01T09:00:00Z" },
        rollback_justified_by_experiment: { experiment_id: "exp:rec", outcome: "recommended", concluded_at: null },
      }),
      histEntry("plain", {}),
    ];
    render(<Fix recs={[]} {...baseProps} changes={changes} view="history" />);
    fireEvent.click(screen.getByText("History"));
    fireEvent.click(screen.getByText("Change switched"));
    expect(screen.getByTestId("fix-hist-trial-applied").textContent).toMatch(
      /^Applied because of your Maximum FPS Trial, .+/,
    );
    expect(screen.getByTestId("fix-hist-trial-undone")).toHaveTextContent("Undone because of your Recommended Trial");
    fireEvent.click(screen.getByText("Change switched"));
    fireEvent.click(screen.getByText("Change plain"));
    expect(screen.queryByTestId("fix-hist-trial-applied")).toBeNull();
    expect(screen.queryByTestId("fix-hist-trial-undone")).toBeNull();
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

// #619: disabling a telemetry task writes the Trust Ledger. Other screens only learn about it through
// LEDGER_CHANGED_EVENT and App's refresh (onChanged), so a disable that lands must announce it and
// then refresh; a refused one does neither and says nothing changed.
describe("Fix telemetry-task disable announces the ledger change", () => {
  beforeEach(() => {
    localStorage.clear();
    invokeMock.mockReset();
  });

  const disableFirstTask = async (onChanged: () => void) => {
    render(<Fix recs={[]} {...baseProps} onChanged={onChanged} />);
    fireEvent.click(await screen.findByText("Telemetry tasks"));
    const buttons = await screen.findAllByRole("button", { name: "Disable" });
    fireEvent.click(buttons[0]);
  };

  it("a disable that lands announces it once, then App's refresh runs", async () => {
    const seen: string[] = [];
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "disable_known_bloat_task") {
        seen.push("disable");
        return Promise.resolve(null);
      }
      return Promise.reject(new Error("no Tauri in tests"));
    });
    const on = () => seen.push("event");
    window.addEventListener(LEDGER_CHANGED_EVENT, on);
    const onChanged = vi.fn(() => {
      seen.push("app-refresh");
    });
    await disableFirstTask(onChanged);
    await screen.findByRole("button", { name: "Disabled · undo in History" });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    window.removeEventListener(LEDGER_CHANGED_EVENT, on);
    expect(invokeMock).toHaveBeenCalledWith("disable_known_bloat_task", { taskId: "compatibility-appraiser" });
    expect(seen).toEqual(["disable", "event", "app-refresh"]);
  });

  it("a refused disable announces nothing and skips App's refresh", async () => {
    invokeMock.mockImplementation(() => Promise.reject(new Error("UAC declined")));
    const seen: string[] = [];
    const on = () => seen.push("event");
    window.addEventListener(LEDGER_CHANGED_EVENT, on);
    const reported = vi.spyOn(console, "error").mockImplementation(() => {});
    const onChanged = vi.fn();
    try {
      await disableFirstTask(onChanged);
      await screen.findByText(/Nothing changed; try again./);
      expect(seen).toEqual([]);
      expect(onChanged).not.toHaveBeenCalled();
      // Still a refusal: every row's button is live for another go, and no refresh failure is reported.
      expect(screen.getAllByRole("button", { name: "Disable" })).toHaveLength(3);
      expect(reported).not.toHaveBeenCalledWith("[compy fix]", expect.anything(), expect.anything());
    } finally {
      reported.mockRestore();
      window.removeEventListener(LEDGER_CHANGED_EVENT, on);
    }
  });

  // Codebase review 2026-11-02: the Optimize station mounts two Fix views; an undo in one (or in
  // History) left this row reading "Disabled" with its button spent, because this click's own "done"
  // outlived the ledger that had since taken over.
  it("once the ledger shows the disable, an undo elsewhere puts the row back to Disable", async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "disable_known_bloat_task" ? Promise.resolve(null) : Promise.reject(new Error("no Tauri in tests")),
    );
    const row = { id: "c1", rec_id: "bloat-task:compatibility-appraiser", status: "applied", is_still_active: true } as AppliedChange;
    const view = (has: boolean) => (
      <Fix recs={[]} {...baseProps} activeChangeFor={(id: string) => (has && id === row.rec_id ? row : undefined)} onChanged={() => {}} />
    );
    const { rerender } = render(view(false));
    fireEvent.click(await screen.findByText("Telemetry tasks"));
    fireEvent.click((await screen.findAllByRole("button", { name: "Disable" }))[0]);
    await screen.findByRole("button", { name: "Disabled · undo in History" });
    // App's refresh: the ledger shows it now.
    rerender(view(true));
    expect(screen.getByRole("button", { name: "Disabled · undo in History" })).toBeDisabled();
    // Undone in History or in the other Fix view.
    rerender(view(false));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Disable" })).toHaveLength(3));
  });

  // A disable that landed is done whatever App's refresh then does. The refresh used to run inside the
  // command's own try, so one that failed painted "Nothing changed; try again." over a task that was
  // already off and recorded, and left the button live for a second run (Codex, #619 round 2).
  const refreshError = new Error("refresh failed");
  it.each<[string, () => Promise<never>]>([
    ["rejects", () => Promise.reject(refreshError)],
    [
      "throws",
      () => {
        throw refreshError;
      },
    ],
  ])("a disable that lands stays done when App's refresh %s, and that failure is reported", async (_how, failing) => {
    const seen: string[] = [];
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "disable_known_bloat_task") {
        seen.push("disable");
        return Promise.resolve(null);
      }
      return Promise.reject(new Error("no Tauri in tests"));
    });
    const on = () => seen.push("event");
    window.addEventListener(LEDGER_CHANGED_EVENT, on);
    const reported = vi.spyOn(console, "error").mockImplementation(() => {});
    const onChanged = vi.fn(() => {
      seen.push("app-refresh");
      return failing();
    });
    try {
      await disableFirstTask(onChanged);
      const done = await screen.findByRole("button", { name: "Disabled · undo in History" });
      await waitFor(() => expect(reported).toHaveBeenCalledWith("[compy fix]", expect.any(String), refreshError));
      // Terminal: this row's button is spent, and nothing says the task is still on.
      expect((done as HTMLButtonElement).disabled).toBe(true);
      expect(screen.queryByText(/Nothing changed; try again./)).toBeNull();
      expect(screen.getAllByRole("button", { name: "Disable" })).toHaveLength(2);
      // The write was announced once, before the refresh, and the command ran once.
      expect(seen).toEqual(["disable", "event", "app-refresh"]);
      expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "disable_known_bloat_task")).toHaveLength(1);
    } finally {
      reported.mockRestore();
      window.removeEventListener(LEDGER_CHANGED_EVENT, on);
    }
  });
});
