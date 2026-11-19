import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
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

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const block = (css: string, selector: string) => {
  const m = stripComments(css).match(new RegExp(`${selector.replace(/[.[\]"=]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`selector ${selector} not found`);
  return m[1];
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

  // s49 fresh-PC pass: "8/9 YOUR SAFE STACK" on an empty ledger read as 8 things the user built.
  // Settings that were simply already on in Windows are headed as such; the heading says "your
  // stack" only when Compy has an active change among them.
  it("heads the ring 'Already set this way' when Compy applied none of them, 'Your safe stack' when it did", () => {
    const rec = (id: string, on: boolean) => ({ ...(fast.recs as never[])[0] as object, id, title: id, currently_applied: on });
    const recs = [rec("game-mode", true), rec("hags", false)] as never[];
    const none = render(
      <ConfirmProvider>
        <OptimizeStation {...fast} recs={recs} />
      </ConfirmProvider>,
    );
    expect(none.container.querySelector(".lab-gauge-caption-k")!.textContent).toBe("Already set this way");
    none.unmount();
    const some = render(
      <ConfirmProvider>
        <OptimizeStation
          {...fast}
          recs={recs}
          activeChangeFor={(id: string) => (id === "game-mode" ? ({ id: "c1", rec_id: id } as never) : undefined)}
        />
      </ConfirmProvider>,
    );
    expect(some.container.querySelector(".lab-gauge-caption-k")!.textContent).toBe("Your safe stack");
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
