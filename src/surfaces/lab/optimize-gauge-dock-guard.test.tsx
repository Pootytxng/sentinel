import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";

// bug→guard (owner-caught 2026-07-10, Ops Console eyeball round 3):
//   1. The safe-stack ring's readout ("8/9") painted over the ring's TOP stroke — a single-line
//      `align-items: baseline` flex anchors its line to the top of the 76px box instead of
//      centering it. The fix splits the job: the outer .lab-gauge-center CENTERS the readout in
//      the ring; an inner .lab-gauge-txt keeps the /total on the big number's baseline.
//   2. The resting PRIMARY dock node (Optimize) wore the exact accent border .dock-node-active
//      wears — it read as pre-selected before any click. Resting primary keeps accent identity
//      (ink + a color-mix faint border); only the OPEN node earns the full accent border + fill.

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));
vi.mock("../../design/use-motion", () => ({ useReducedMotion: () => true }));

const { OptimizeStation } = await import("./OptimizeStation");
const { ConfirmProvider } = await import("../../design/ConfirmDialog");
import type { LabFastPathProps } from "./OptimizeStation";

afterEach(cleanup);
// Dismissals persist in localStorage AND in the module-level store behind useDismissed — clear the
// storage and let the 0-subscriber remount re-read it, so no test inherits another's set-asides.
beforeEach(() => localStorage.clear());

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const block = (css: string, selector: string) => {
  const m = stripComments(css).match(new RegExp(`${selector.replace(/[.[\]"=]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`selector ${selector} not found`);
  return m[1];
};

// Walk the REAL decline path a user walks: open the first slim row, press its "Not for me".
// Nothing here reaches into state — if the control moves or the wiring breaks, this breaks.
const setAsideFirstRow = (container: HTMLElement) => {
  fireEvent.click(container.querySelector(".slimrow-toggle") as HTMLButtonElement);
  const notForMe = [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Not for me"),
  ) as HTMLButtonElement;
  expect(notForMe).toBeTruthy();
  fireEvent.click(notForMe);
};

const fast: LabFastPathProps = {
  recs: [
    {
      id: "game-mode",
      title: "Game Mode",
      category: "system",
      severity: "safe",
      description: "d",
      impact: "i",
      downside: null,
      applies_to: "all",
      currently_applied: false,
      provenance: "verified",
      eligible: true,
    },
  ] as never[],
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
};

describe("safe-stack gauge readout centering (owner-caught: digits over the ring stroke)", () => {
  it("renders the num + den inside a .lab-gauge-txt baseline group inside the centered box", () => {
    const { container } = render(
      <ConfirmProvider>
        <OptimizeStation {...fast} />
      </ConfirmProvider>,
    );
    expect(container.querySelector(".lab-gauge-center > .lab-gauge-txt > .lab-gauge-num")).toBeTruthy();
    expect(container.querySelector(".lab-gauge-center > .lab-gauge-txt > .lab-gauge-den")).toBeTruthy();
    // No stray direct children of the center box — everything rides the centered group.
    expect(container.querySelector(".lab-gauge-center > .lab-gauge-num")).toBeNull();
  });

  it("caption never re-frames a DRIFTED rec as a fresh enable (one-mention law)", () => {
    // The rec is not currently applied AND its newest ledger entry drifted off — the drift group
    // owns it, so the ring caption must tell the drift story, not "1 left to enable below"
    // (which contradicted the corner gauge's ready count; owner-sweep catch 2026-07-10).
    const drifted = {
      ...fast,
      changes: [
        {
          id: "c1",
          rec_id: "game-mode",
          rec_title: "Game Mode",
          status: "applied",
          is_still_active: false,
        },
      ] as never[],
    };
    const { container } = render(
      <ConfirmProvider>
        <OptimizeStation {...drifted} />
      </ConfirmProvider>,
    );
    const caption = container.querySelector(".lab-gauge-caption")!.textContent!;
    expect(caption).toContain("1 was turned off outside Compy — restore it below.");
    expect(caption).not.toContain("left to enable");
  });

  it("caption splits the mixed case: fresh enables AND drifted restores, each named", () => {
    const mixed = {
      ...fast,
      recs: [
        ...(fast.recs as never[]),
        {
          id: "hags",
          title: "Hardware GPU scheduling",
          category: "system",
          severity: "safe",
          description: "d",
          impact: "i",
          downside: null,
          applies_to: "all",
          currently_applied: false,
          provenance: "verified",
          eligible: true,
        },
      ] as never[],
      changes: [
        {
          id: "c1",
          rec_id: "game-mode",
          rec_title: "Game Mode",
          status: "applied",
          is_still_active: false,
        },
      ] as never[],
    };
    const { container } = render(
      <ConfirmProvider>
        <OptimizeStation {...mixed} />
      </ConfirmProvider>,
    );
    expect(container.querySelector(".lab-gauge-caption")!.textContent).toContain(
      "2 left below — 1 to enable, 1 turned off outside Compy.",
    );
  });

  it("caption still offers the fresh-enable line when nothing drifted", () => {
    const { container } = render(
      <ConfirmProvider>
        <OptimizeStation {...fast} />
      </ConfirmProvider>,
    );
    expect(container.querySelector(".lab-gauge-caption")!.textContent).toContain(
      "1 left to enable below — one tap each, reversible.",
    );
  });

  // bug→guard (self-review round 8, 2026-07-29): the ring's caption counted the safe stack from
  // `props.recs` alone and never consulted the dismissal set, while `useDismissed` handed every
  // caller its own copy — so setting the last tweak aside in the list left the ring overhead still
  // saying "1 left to enable below" directly above the list's own "Nothing waiting". This is the
  // JOURNEY assertion (click the real control, read the real caption), which is what would have
  // caught it: the two halves of the fix are individually green-able and only meet here.
  it("setting a rec aside in the list updates the ring caption in the SAME render", () => {
    const { container } = render(
      <ConfirmProvider>
        <OptimizeStation {...fast} />
      </ConfirmProvider>,
    );
    const caption = () => container.querySelector(".lab-gauge-caption")!.textContent!;
    expect(caption()).toContain("1 left to enable below");
    setAsideFirstRow(container);

    // Not "all applied" (a lie about the rig — the tweak is still off) and not "left to enable"
    // (a lie about the list — there's nothing there to tap). The set-aside is stated, with the
    // way back offered in the same breath.
    expect(caption()).toContain("Nothing waiting — the last one is set aside.");
    expect(caption()).not.toContain("left to enable");
    expect(caption()).not.toContain("already on for this rig");
  });

  it("with work still outstanding, the caption reconciles the set-aside remainder", () => {
    const two = {
      ...fast,
      recs: [
        ...(fast.recs as never[]),
        {
          id: "hags",
          title: "Hardware GPU scheduling",
          category: "system",
          severity: "safe",
          description: "d",
          impact: "i",
          downside: null,
          applies_to: "all",
          currently_applied: false,
          provenance: "verified",
          eligible: true,
        },
      ] as never[],
    };
    const { container } = render(
      <ConfirmProvider>
        <OptimizeStation {...two} />
      </ConfirmProvider>,
    );
    const caption = () => container.querySelector(".lab-gauge-caption")!.textContent!;
    expect(caption()).toContain("2 left to enable below");
    setAsideFirstRow(container);
    // The ring still reads 0/2 (nothing was applied) — so the caption has to account for the
    // difference between the ring's total and the one row left below, or the user is left with
    // an unexplained missing tweak.
    expect(caption()).toContain("1 left to enable below");
    expect(caption()).toContain("1 more is set aside.");
  });

  it("CSS: the outer box centers, the inner group owns the baseline", () => {
    const css = readFileSync(join("src", "surfaces", "lab", "OptimizeStation.css"), "utf8");
    const center = block(css, ".lab-gauge-center");
    expect(center).toMatch(/align-items:\s*center/);
    expect(center).not.toMatch(/align-items:\s*baseline/);
    const txt = block(css, ".lab-gauge-txt");
    expect(txt).toMatch(/align-items:\s*baseline/);
  });
});

describe("dock primary vs active distinction (owner-caught: Optimize looked pre-selected)", () => {
  const css = readFileSync(join("src", "design", "console", "dock.css"), "utf8");

  it("a RESTING primary never wears the full accent border the active state uses", () => {
    const primary = block(css, ".dock-node-primary");
    // Identity stays the accent hue — now via the legibility-adaptive accent-text token (== accent for
    // bright/preset/flag-off, a legible light tint for a DARK per-room pick; room-identity 2026-07-13).
    expect(primary).toMatch(/color:\s*var\(--ix-accent-text\)/);
    // …but the border must be a mixed/faint accent, never the bare accent the active node wears.
    expect(primary).toMatch(/border-color:\s*color-mix\(/);
    expect(primary).not.toMatch(/border-color:\s*var\(--ix-accent\)\s*;/);
  });

  it("the ACTIVE node is unambiguous: full accent border + a tinted fill", () => {
    const active = block(css, ".dock-node-active");
    expect(active).toMatch(/border-color:\s*var\(--ix-accent\)/);
    expect(active).toMatch(/background:\s*color-mix\(/);
  });
});
