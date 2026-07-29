import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

// BUG → GUARD (self-review FAIL, 2026-07-28, product-recovery train).
//
// The defect: ONE recommendation was named THREE different ways inside a single scroll — the deck's
// "next best move" card and the carried-arrival banner printed the raw catalog title ("Ultimate
// Performance power plan") while the Optimize row directly beneath printed the friendly headline
// ("Stop your PC from throttling itself"). Green tsc + green vitest + green journey tests all missed
// it, because every one of them asserted a surface in isolation. A non-technical gamer reading that
// page cannot tell those are the same tweak — which is precisely the orientation failure this train
// exists to fix (recovery items 2, 4, 9, 18: "verify the complete user journey").
//
// The guard: every surface that names a rec resolves the name through data/friendly-labels'
// recDisplayLabel. This test renders the whole journey — the Check card, the deck's move card, the
// arrival banner, the destination row — with the Living Instrument preview ON, and asserts they all
// print the SAME string for the same rec id. Add a fourth naming surface without routing it through
// recDisplayLabel and this fails.

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));
vi.mock("../rig/RigViewer", () => ({ RigViewer: () => <div data-testid="rig-hologram" /> }));

class IOStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
vi.stubGlobal("IntersectionObserver", IOStub);

const { LabDeck } = await import("../lab/LabDeck");
const { ConfirmProvider } = await import("../../design/ConfirmDialog");
const { RecDetailCard } = await import("../../design/RecDetailCard");
const { describeRec } = await import("../../data/rec-detail");
const { writeHandoff } = await import("../../data/check-handoff");
const { FRIENDLY_LABELS, recDisplayLabel } = await import("../../data/friendly-labels");

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.living;
});
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("compy_motion", "reduced");
  // The preview that turns on the friendly names. With it OFF every surface prints the catalog
  // title and the bug is invisible — so the guard has to run with it ON.
  document.documentElement.dataset.living = "on";
});

// A rec with a friendly headline AND a technical title that differ maximally: the catalog title
// shares no words with the headline, so "did this surface use the shared layer?" has one answer.
const REC_ID = "power-ultimate";
const CATALOG_TITLE = "Ultimate Performance power plan";
const HEADLINE = FRIENDLY_LABELS[REC_ID].headline;
const TECH = FRIENDLY_LABELS[REC_ID].tech!;

const rec = (over: Record<string, unknown> = {}) =>
  ({
    id: REC_ID,
    title: CATALOG_TITLE,
    category: "Power",
    severity: "safe",
    description: "Windows' hidden power plan, which stops the CPU idling between frames.",
    impact: "Switches the active power plan.",
    downside: null,
    applies_to: "Currently Balanced",
    currently_applied: false,
    provenance: "verified",
    eligible: true,
    ...over,
  }) as never;

const renderDeck = () => {
  const fast = {
    recs: [rec()],
    startup: [],
    changes: [],
    busyId: null,
    isAppliable: () => true,
    activeChangeFor: () => undefined,
    onToggleRec: () => {},
    onToggleStartup: () => {},
    onRollback: () => {},
    onApplyBatch: async () => ({ applied: 0, skipped: [] }),
    onOpenLibrary: () => {},
    onChanged: () => {},
    sessions: [],
    gpus: [],
    vendor: "amd",
  } as never;
  return render(
    <ConfirmProvider>
      <LabDeck
        fast={fast}
        diagnostics={<div data-testid="diag" />}
        diagnosticsCaptured
        priorities={null}
        activeCount={0}
      />
    </ConfirmProvider>,
  ).container;
};

const text = (el: Element | null) => el?.textContent ?? "";

describe("one name per recommendation, everywhere the user meets it", () => {
  it("the move card, the arrival banner and the destination row print the identical name", () => {
    writeHandoff({ station: "optimize", rec_ids: [REC_ID], source: "check" });
    const c = renderDeck();

    // 1. Section 1 — "your next best move".
    expect(text(c.querySelector(".ld-move-head"))).toBe(HEADLINE);
    expect(text(c.querySelector(".ld-move-tech"))).toBe(TECH);

    // 2. Section 2 — the arrival banner ("Compy found these during your check").
    const carried = Array.from(c.querySelectorAll(".lab-carried-item"));
    expect(carried.length).toBe(1);
    expect(text(carried[0].querySelector(".lab-carried-name"))).toBe(HEADLINE);
    expect(text(carried[0].querySelector(".lab-carried-tech"))).toBe(TECH);

    // 3. Section 2 — the row the banner is pointing at.
    const rowHeadlines = Array.from(c.querySelectorAll(".fix-row-headline")).map(text);
    expect(rowHeadlines).toContain(HEADLINE);

    // 4. And nothing in that chain leads with the raw catalog title. (It stays reachable under
    //    "What's this?" and in exports — it just isn't a second name for the same thing.)
    expect(text(c.querySelector(".ld-move-head"))).not.toContain(CATALOG_TITLE);
    expect(text(carried[0].querySelector(".lab-carried-name"))).not.toContain(CATALOG_TITLE);
  });

  it("the Check card names it the same way the Lab does", () => {
    const d = describeRec(rec(), () => true);
    const { container } = render(
      <RecDetailCard
        d={d}
        labels={{
          detected: "Found",
          what: "What",
          changes: "Changes",
          catch: "Catch",
          apply: "Apply",
          applying: "Applying",
          applyAria: (title: string) => `Apply ${title}`,
          applied: "Applied",
          ineligibleFallback: "Not for this rig",
          manual: "Hands-on",
          manualWithSteps: "Hands-on",
          steps: "Show steps",
        }}
        walkthrough={null}
        vendor="amd"
        variant="switch"
        showTitle
        busy={false}
        disabled={false}
        onApply={() => {}}
      />,
    );
    expect(text(container.querySelector(".rd-rec-title"))).toBe(`${HEADLINE}${TECH}`);
    // The spoken name matches the read name — no screen-reader-only second vocabulary.
    const applyControl = container.querySelector("[aria-label]");
    expect(applyControl?.getAttribute("aria-label")).toBe(`Apply ${HEADLINE}`);
  });

  it("an unmapped rec keeps its catalog title verbatim in every surface", () => {
    // Not every rec has a friendly headline (plain ones are deliberately absent from the map).
    // The shared layer must fall through to the real title rather than inventing one.
    const plain = recDisplayLabel("free-space-c", "Free up space on C:");
    expect(plain.headline).toBe("Free up space on C:");
    expect(plain.tech).toBeNull();
    expect(plain.friendly).toBe(false);
  });

  it("with the preview off, every surface falls back to the catalog title together", () => {
    delete document.documentElement.dataset.living;
    expect(recDisplayLabel(REC_ID, CATALOG_TITLE)).toEqual({
      headline: CATALOG_TITLE,
      tech: null,
      friendly: false,
    });
  });
});
