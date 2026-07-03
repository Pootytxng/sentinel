import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Fix, { SlimFixRow } from "./surfaces/Fix";
import { slimProofLine } from "./data/slim-proof";
import { REC_MUTATIONS } from "./data/rec-mutations";
import type { Provenance } from "./data/provenance";

// slim-row-proof-guard (P1 UI slim-down HARD LINE 2, council 🔴): the collapsed slim row must
// ALWAYS carry one non-empty measured evidence/reason line. Hiding the proof behind the tap is the
// black-box failure mode Compy attacks — this guard makes the guardrail grep-proof and CI-enforced.
// Also pins the affordance ceiling (≤3 interactives per collapsed row), the detail-panel contract
// (Walkthrough / What's this? / Dismiss revealed on tap; dismiss absent when applied), §8c
// pre-selection (selection ≠ application, no auto-apply ever), and the Fixes-only scope.

type Sev = "safe" | "moderate" | "advanced";
const rec = (id: string, provenance: Provenance = "expected-impact", severity?: Sev, over = {}) => ({
  id,
  title: `Title ${id}`,
  description: `desc ${id}`,
  impact: `impact ${id}`,
  currently_applied: false,
  provenance,
  severity,
  ...over,
});

const baseProps = {
  startup: [],
  changes: [],
  busyId: null,
  isAppliable: () => true,
  activeChangeFor: () => undefined,
  onToggleRec: vi.fn(),
  onToggleStartup: vi.fn(),
  onRollback: vi.fn(),
  onApplyBatch: vi.fn().mockResolvedValue({ applied: 0, skipped: [] }),
  onOpenLibrary: vi.fn(),
  vendor: "any" as const,
};

afterEach(() => {
  localStorage.clear();
});

describe("slim-row-proof-guard — the proof line is never empty, never hidden", () => {
  it("slimProofLine is non-empty for EVERY provenance tier, even with no prose at all", () => {
    const tiers: Provenance[] = ["verified", "measured-signal", "expected-impact"];
    for (const provenance of tiers) {
      for (const [impact, description] of [
        ["impact text", "desc text"],
        ["", "desc text"],
        ["impact text", ""],
        ["", ""], // the degenerate rec: the tier + the rollback promise still stand
        ["   ", "   "],
      ]) {
        const line = slimProofLine({ provenance, impact, description });
        expect(line.trim().length, `${provenance} / "${impact}" / "${description}"`).toBeGreaterThan(0);
      }
    }
  });

  it("every known catalog rec id renders a collapsed slim row with a non-empty proof line (worst case: no prose)", () => {
    // REC_MUTATIONS is the frontend's per-rec map of the real apply paths — the closest thing to
    // the frozen catalog on this side of the IPC boundary. Empty prose = the degenerate fixture.
    const { container } = render(
      <ul>
        {Object.keys(REC_MUTATIONS).map((id) => (
          <SlimFixRow
            key={id}
            rec={rec(id, "expected-impact", undefined, { impact: "", description: "" })}
            applied={false}
            activeChange={undefined}
            busy={false}
            onToggle={() => {}}
            onWhatsThis={() => {}}
            onDismiss={() => {}}
            vendor="any"
          />
        ))}
      </ul>,
    );
    const proofs = container.querySelectorAll(".slimrow-proof");
    expect(proofs.length).toBe(Object.keys(REC_MUTATIONS).length);
    for (const p of proofs) expect(p.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it("every rendered collapsed slim row carries a non-empty proof line and ≤3 interactives", () => {
    const recs = [
      rec("game-mode", "verified", "safe"),
      rec("sysmain-disable", "measured-signal", "moderate"),
      // A rec with NO prose at all — the proof line must still be non-empty (tier + reversible).
      rec("hags-enable", "expected-impact", "safe", { impact: "", description: "" }),
    ];
    const { container } = render(<Fix recs={recs} {...baseProps} view="fixes" />);
    const rows = container.querySelectorAll(".slimrow");
    expect(rows.length).toBe(3);
    for (const row of rows) {
      const proof = row.querySelector(".slimrow-proof");
      expect(proof?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
      const tabbables = row.querySelectorAll(
        'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      expect(tabbables.length).toBeLessThanOrEqual(3);
    }
  });
});

describe("slim row detail panel (in-place reveal)", () => {
  it("tap reveals Walkthrough / What's this? / Dismiss; TrustSwitch still routes onToggleRec", () => {
    const onToggleRec = vi.fn();
    render(<Fix recs={[rec("game-mode", "verified", "safe")]} {...baseProps} onToggleRec={onToggleRec} view="fixes" />);
    // Collapsed: none of the detail affordances are in the tree.
    expect(screen.queryByText("Not for me")).toBeNull();
    expect(screen.queryByText("What's this?")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Title game-mode/ }));
    expect(screen.getByText("Not for me")).toBeTruthy();
    // "What's this?" is now an in-place hover/focus tooltip (V2 polish 2026-07-03): tapping the
    // trigger reveals a short blurb WITHOUT leaving the section, and keeps the full Blackbook entry
    // one tap away via "More" (doctrine: measured detail one tap away — access preserved, not removed).
    const whatsThis = screen.getByRole("button", { name: "What's this?" }); // game-mode resolves an entry
    fireEvent.click(whatsThis);
    expect(screen.getByRole("tooltip")).toBeTruthy();
    expect(screen.getByText(/More in the Blackbook/)).toBeTruthy();
    expect(screen.getByText("Show me the way")).toBeTruthy(); // game-mode has a walkthrough
    // The one control keeps the EXISTING TrustSwitch semantics — same audited path.
    fireEvent.click(screen.getByRole("switch", { name: /Apply Title game-mode/ }));
    expect(onToggleRec).toHaveBeenCalledWith("game-mode");
  });

  it("dismiss is absent when the rec is currently applied (roll back instead)", () => {
    render(
      <ul>
        <SlimFixRow
          rec={rec("game-mode", "verified", "safe", { currently_applied: true })}
          applied={true}
          activeChange={undefined}
          busy={false}
          onToggle={() => {}}
          onWhatsThis={() => {}}
          onDismiss={() => {}}
          vendor="any"
        />
      </ul>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Title game-mode/ }));
    expect(screen.queryByText("Not for me")).toBeNull();
    // The applied row carries the snapshot line instead — rollback stays one glance away.
    expect(screen.getByText(/snapshot captured — restores/)).toBeTruthy();
  });
});

describe("§8c — pre-selected Recommended (selection ≠ application)", () => {
  it("the consent sheet arrives with every Recommended ticked; deselect narrows the batch to EXACTLY the ticked set", () => {
    const onApplyBatch = vi.fn().mockResolvedValue({ applied: 1, skipped: [] });
    const recs = [rec("game-mode", "verified", "safe"), rec("sysmain-disable", "verified", "safe")];
    render(<Fix recs={recs} {...baseProps} onApplyBatch={onApplyBatch} view="fixes" />);
    // NO auto-apply on render, ever.
    expect(onApplyBatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply reviewed (2)" }));
    // Recommended arrive selected…
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    for (const b of boxes) expect((b as HTMLInputElement).checked).toBe(true);
    // …one-tap deselect; the list shows exactly what will change…
    fireEvent.click(screen.getByRole("checkbox", { name: "Include Title sysmain-disable" }));
    // …and Apply (the explicit act) batches ONLY the ticked set.
    fireEvent.click(screen.getByRole("button", { name: "Apply selected (1)" }));
    expect(onApplyBatch).toHaveBeenCalledWith(["game-mode"]);
  });

  it("nothing ticked ⇒ Apply is disabled (an empty batch can't be fired)", () => {
    const recs = [rec("game-mode", "verified", "safe"), rec("sysmain-disable", "verified", "safe")];
    render(<Fix recs={recs} {...baseProps} view="fixes" />);
    fireEvent.click(screen.getByRole("button", { name: "Apply reviewed (2)" }));
    for (const b of screen.getAllByRole("checkbox")) fireEvent.click(b);
    expect((screen.getByRole("button", { name: "Apply selected (0)" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("scope — slim rows are the Fixes segment's look only", () => {
  it("non-fixes views (standalone Tune view=\"all\") keep the classic FixRow path", () => {
    const { container } = render(<Fix recs={[rec("game-mode", "verified", "safe")]} {...baseProps} />);
    expect(container.querySelectorAll(".slimrow").length).toBe(0);
    expect(container.querySelectorAll(".fix-row").length).toBeGreaterThan(0);
  });
});
