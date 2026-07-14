import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { OptimizeV2 } from "./OptimizeV2";
import { optimizeVerdict, safeFixesReady } from "./optimize-v2-data";
import type { AppliedChange, GameReadiness, Recommendation } from "../types";

// V2-4 guards (bug→guard tier 1): the V2 Optimize room composes RoomShell (one verdict, one
// door), its verdict is a PURE derivation from the real catalog (honestly-loading while recs
// haven't resolved, branch-proper copy — never "(s)"), the "N active · undo" chip is the one
// primary action and lands on Applied, every apply entry point lands on Applied (the classic
// shell's council contract, preserved), and the quiet side-pile expander exists only where the
// piles portal in (Fixes).

// Check and Fix are the audited heavy surfaces — composed VERBATIM with the same props, covered
// by their own suites. Stubs here expose the routed handlers so the landing contract is testable.
vi.mock("./Check", () => ({
  default: (props: { onChanged: () => void }) => (
    <div data-testid="check-surface">
      <button type="button" onClick={props.onChanged}>
        stub-inline-apply
      </button>
    </div>
  ),
}));
vi.mock("./Fix", () => ({
  default: (props: { view: string; onToggleRec: (id: string) => void }) => (
    <div data-testid={`fix-${props.view}`}>
      <button type="button" onClick={() => props.onToggleRec("game-mode")}>
        stub-toggle-rec
      </button>
    </div>
  ),
}));

beforeAll(() => {
  // jsdom lacks the observers the vendored DecryptedText uses (IntersectionObserver) and the
  // SegmentedControl's measurement path tolerates zero-rects; inert stubs, animation never starts.
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  class IO {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (globalThis as Record<string, unknown>).ResizeObserver ??= RO;
  (globalThis as Record<string, unknown>).IntersectionObserver ??= IO;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

// This suite pins the CLASSIC room composition — the Instrument HUD is default-ON since the
// 2026-07-06 owner approval, so the classic tree lives behind the "0" failsafe; the HUD
// masthead's own contract is pinned in hud-rooms-flag.test.tsx.
beforeEach(() => localStorage.setItem("compy_editorial", "0"));

const rec = (over: Partial<Recommendation>): Recommendation =>
  ({
    id: "game-mode",
    title: "Windows Game Mode",
    category: "Gaming",
    severity: "safe",
    description: "",
    impact: "",
    downside: null,
    applies_to: "all",
    currently_applied: false,
    provenance: "verified",
    ...over,
  }) as Recommendation;

const readiness: GameReadiness = {
  checks: [
    { id: "a", label: "A", status: "ready", detail: "", value: null },
    { id: "b", label: "B", status: "ready", detail: "", value: null },
    { id: "c", label: "C", status: "unknown", detail: "", value: null },
  ],
  ready_count: 2,
  attention_count: 0,
  unknown_count: 1,
  advisory_count: 0,
  advisory: "",
  dismissed_ids: [],
  drifts: [],
};

const APPLIABLE = new Set(["game-mode", "hags-enable"]);
const isAppliable = (id: string) => APPLIABLE.has(id);

const recsFixture: Recommendation[] = [
  rec({ id: "game-mode" }), // safe + appliable + not applied → counts
  rec({ id: "hags-enable", currently_applied: true }), // applied → excluded
  rec({ id: "visual-effects" }), // safe but NOT one-click here → excluded
  rec({ id: "nagle-disable", severity: "moderate" }), // not safe-tier → excluded
  rec({ id: "power-ultimate", eligible: false }), // ineligible → excluded
];

function mount(over: Partial<Parameters<typeof OptimizeV2>[0]> = {}) {
  const props = {
    isAppliable,
    onOpenLibrary: vi.fn(),
    onChanged: vi.fn(),
    vendor: "amd" as const,
    recs: recsFixture,
    startup: [],
    changes: [] as AppliedChange[],
    busyId: null,
    activeChangeFor: () => undefined,
    onToggleRec: vi.fn(),
    onToggleStartup: vi.fn(),
    onRollback: vi.fn(),
    onApplyBatch: vi.fn().mockResolvedValue({ applied: 0, skipped: [] }),
    readiness,
    priorities: null,
    activeCount: 0,
    ...over,
  };
  const utils = render(<OptimizeV2 {...props} />);
  return { ...utils, props };
}

const useReduced = () => localStorage.setItem("compy_motion", "reduced");

describe("optimizeVerdict — pure, measured, branch-proper copy", () => {
  it("counts only safe + one-click + eligible + not-applied recs", () => {
    expect(safeFixesReady(recsFixture, isAppliable)).toBe(1);
  });

  it("catalog not resolved → honestly loading, not settled (no animation on a placeholder)", () => {
    const v = optimizeVerdict(null, isAppliable, 0);
    expect(v.settled).toBe(false);
    expect(v.headline).toBe("Checking what's safe to change…");
  });

  it("branches singular/plural properly — never '(s)'", () => {
    expect(optimizeVerdict(recsFixture, isAppliable, 0).headline).toBe(
      "1 safe fix is ready to apply.",
    );
    const two = [...recsFixture, rec({ id: "hags-enable", currently_applied: false })];
    expect(optimizeVerdict(two, isAppliable, 0).headline).toBe(
      "2 safe fixes are ready to apply.",
    );
    const none: Recommendation[] = [];
    expect(optimizeVerdict(none, isAppliable, 1).headline).toBe(
      "Nothing new to apply — 1 safe change is active.",
    );
    expect(optimizeVerdict(none, isAppliable, 3).headline).toBe(
      "Nothing new to apply — 3 safe changes are active.",
    );
    expect(optimizeVerdict(none, isAppliable, 0).headline).toBe(
      "Nothing needs applying right now.",
    );
    // The pluralization law, mechanized: no branch may emit the lazy "(s)".
    for (const [recs, active] of [
      [recsFixture, 0],
      [two, 2],
      [none, 1],
      [none, 5],
      [none, 0],
      [null, 0],
    ] as const) {
      const v = optimizeVerdict(recs, isAppliable, active);
      expect(`${v.headline} ${v.sub ?? ""}`).not.toContain("(s)");
    }
  });

  // V2-8 (P6 §2): allClear is the door signal — true ONLY once the catalog settled with no safe
  // one-click fix left (active changes or a clean rig both count as chapter-finished).
  it("allClear: false while loading or fixes remain; true when nothing is left to apply", () => {
    expect(optimizeVerdict(null, isAppliable, 0).allClear).toBe(false);
    expect(optimizeVerdict(recsFixture, isAppliable, 0).allClear).toBe(false);
    expect(optimizeVerdict([], isAppliable, 0).allClear).toBe(true);
    expect(optimizeVerdict([], isAppliable, 2).allClear).toBe(true);
    expect(optimizeVerdict([rec({ id: "game-mode", currently_applied: true })], isAppliable, 1).allClear).toBe(true);
  });

  // V2-9 punch (g), mechanized: a drifted re-enable is NOT "ready to apply". The body renders
  // drifted recs only under "Applied — turned off outside Compy" (V2-4b one-mention), so the
  // verdict describes that state — and the door stays closed while the actionable row remains.
  it("drifted-only → names the outside-Compy switch-off, never 'ready to apply'", () => {
    const v = optimizeVerdict(recsFixture, isAppliable, 0, [{ rec_id: "game-mode" }]);
    expect(v.headline).toBe("1 change you applied was turned off outside Compy.");
    expect(v.sub).toContain("never re-applies");
    expect(v.allClear).toBe(false);
    const both = [...recsFixture, rec({ id: "hags-enable", currently_applied: false })];
    const v2 = optimizeVerdict(both, isAppliable, 0, [
      { rec_id: "game-mode" },
      { rec_id: "hags-enable" },
    ]);
    expect(v2.headline).toBe("2 changes you applied were turned off outside Compy.");
    for (const x of [v, v2]) expect(`${x.headline} ${x.sub ?? ""}`).not.toContain("(s)");
  });

  it("a fresh safe fix still leads the verdict; a drifted rec never inflates the ready count", () => {
    const mixed = [...recsFixture, rec({ id: "hags-enable", currently_applied: false })];
    const v = optimizeVerdict(mixed, isAppliable, 0, [{ rec_id: "hags-enable" }]);
    expect(v.headline).toBe("1 safe fix is ready to apply.");
    expect(safeFixesReady(mixed, isAppliable, new Set(["hags-enable"]))).toBe(1);
  });

  // bug→guard (optimize-v2-data.ts): when ready fixes AND drifted changes coexist, the body shows
  // BOTH — the ready rows and the "turned off outside Compy" section — so the verdict must name the
  // drift too (V2-9 (g): the verdict describes the state the body actually shows). Before this the
  // drifted rows rendered with zero mention in the verdict when a ready fix led.
  it("ready fix leading + drifted rows present → sub names the drift too, branch-proper", () => {
    const mixed = [
      ...recsFixture, // 1 ready (game-mode)
      rec({ id: "hags-enable", currently_applied: false }),
      rec({ id: "sysmain-disable", currently_applied: false }),
    ];
    // one drift
    const v1 = optimizeVerdict(mixed, isAppliable, 0, [{ rec_id: "hags-enable" }]);
    expect(v1.headline).toBe("1 safe fix is ready to apply.");
    expect(v1.sub).toContain("1 change you applied was turned off outside Compy");
    // two drifts → plural, still branch-proper (never "(s)")
    const v2 = optimizeVerdict(mixed, isAppliable, 0, [
      { rec_id: "hags-enable" },
      { rec_id: "sysmain-disable" },
    ]);
    expect(v2.sub).toContain("2 changes you applied were turned off outside Compy");
    for (const x of [v1, v2]) expect(`${x.headline} ${x.sub ?? ""}`).not.toContain("(s)");
  });
});

describe("OptimizeV2 — RoomShell composition", () => {
  it("renders ONE verdict (the pure helper's output); the door STAYS CLOSED while a fix is ready", () => {
    useReduced();
    const { container } = mount();
    const h1s = container.querySelectorAll(".v2-verdict h1");
    expect(h1s.length).toBe(1);
    expect(h1s[0].textContent).toBe("1 safe fix is ready to apply.");
    // V2-8 (P6 §2): the door is the reward for finishing the chapter, not a bypass — with a safe
    // fix still unapplied there is no forward door.
    expect(container.querySelectorAll(".v2-door").length).toBe(0);
  });

  it("all-clear → exactly ONE forward door to Monitor (the finished-chapter reward)", () => {
    useReduced();
    const { container } = mount({ recs: [], activeCount: 1 });
    const doors = container.querySelectorAll(".v2-door");
    expect(doors.length).toBe(1);
    expect(doors[0].textContent).toContain("Watch it live");
  });

  it("no door while the catalog is still loading (no forward door on an unmeasured room)", () => {
    useReduced();
    const { container } = mount({ recs: null, readiness: null });
    expect(container.querySelectorAll(".v2-door").length).toBe(0);
  });

  it("no measured-line header strip — header space is header-format text only (owner law 2026-07-10)", () => {
    useReduced();
    const { container } = mount();
    expect(container.querySelector(".v2-measured")).toBeNull();
  });

  it("recs unresolved → loading verdict, nothing fabricated", () => {
    useReduced();
    mount({ recs: null, readiness: null });
    expect(screen.getByText("Checking what's safe to change…")).toBeTruthy();
  });
});

describe("OptimizeV2 — the one primary action (N active · undo)", () => {
  it("hidden when nothing is active; renders the measured count and lands on Applied", () => {
    useReduced();
    const { container, unmount } = mount();
    expect(container.querySelector(".ov2-chip")).toBeNull();
    unmount();
    const { container: withActive } = mount({ activeCount: 2 });
    expect(withActive.querySelectorAll(".v2-verdict-action").length).toBe(1);
    const chip = withActive.querySelector(".ov2-chip") as HTMLElement;
    expect(chip.textContent).toContain("2");
    expect(chip.textContent).toContain("active · undo");
    expect(screen.queryByTestId("fix-ledger")).toBeNull();
    fireEvent.click(chip);
    expect(screen.getByTestId("fix-ledger")).toBeTruthy();
    expect(screen.queryByTestId("check-surface")).toBeNull();
  });
});

describe("OptimizeV2 — apply entry points land on Applied (council contract preserved)", () => {
  it("a rec toggle routes through the SAME handler and lands on Applied", () => {
    useReduced();
    const { props } = mount();
    fireEvent.click(screen.getByText("stub-toggle-rec"));
    expect(props.onToggleRec).toHaveBeenCalledWith("game-mode");
    expect(screen.getByTestId("fix-ledger")).toBeTruthy();
  });

  it("Check's inline apply (onChanged) also lands on Applied", () => {
    useReduced();
    const { props } = mount();
    fireEvent.click(screen.getByText("stub-inline-apply"));
    expect(props.onChanged).toHaveBeenCalled();
    expect(screen.getByTestId("fix-ledger")).toBeTruthy();
  });
});

describe("OptimizeV2 — quiet slot (side piles) and segments", () => {
  it("the quiet expander exists on Fixes only, and the drawer actually opens/closes", () => {
    useReduced();
    const { container } = mount();
    const head = screen.getByRole("button", { name: /Nothing else needs attention/ });
    const body = container.querySelector("#ov2-sidepile-body") as HTMLElement;
    expect(body.hidden).toBe(true);
    fireEvent.click(head);
    expect(body.hidden).toBe(false);
    // Applied segment: no side piles portal there — the quiet slot is gone.
    fireEvent.click(screen.getByRole("tab", { name: "Applied" }));
    expect(screen.queryByRole("button", { name: /Nothing else needs attention/ })).toBeNull();
  });

  it("setup summary is a RECORD: renders on Applied, not in the fixes flow (V2-4b relocation)", () => {
    useReduced();
    const { container } = mount({
      priorities: {
        limiters: [],
        already_fine: [],
        not_worth_touching: [],
        session_hint: null,
        upgrade_path: null,
      },
    });
    expect(screen.queryByText("Setup summary")).toBeNull(); // Fixes segment: absent
    fireEvent.click(screen.getByRole("tab", { name: "Applied" }));
    expect(screen.getByText("Setup summary")).toBeTruthy();
    expect(container.querySelector(".ov2-summary-text")?.textContent).toContain(
      "Compy setup summary",
    );
  });

  it("upgrade path renders as the labeled-early card BELOW the body (V2-4b demotion)", () => {
    useReduced();
    const { container } = mount({
      priorities: {
        limiters: [],
        already_fine: [],
        not_worth_touching: [],
        session_hint: null,
        upgrade_path: {
          items: [
            {
              kind: "gpu",
              title: "GPU was the measured limiter",
              why: "GPU usage peaked very high.",
              links: [{ retailer: "Amazon", url: "https://amazon.example/q" }],
            },
          ],
          disclosure: "x",
        },
      },
    });
    const card = container.querySelector(".ov2-upgrade") as HTMLElement;
    expect(card.textContent).toContain("GPU was the measured limiter");
    expect(card.textContent).toContain("early — being developed");
    // Below the groups: the card follows the Fix stub in DOM order.
    const body = container.querySelector(".ov2-body") as HTMLElement;
    const fix = screen.getByTestId("fix-fixes");
    expect(body.contains(card)).toBe(true);
    expect(fix.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("Gaming Mode is a segment ONLY when the gate passes a slot (dark = absent)", () => {
    useReduced();
    const { unmount } = mount();
    expect(screen.queryByRole("tab", { name: "Gaming Mode" })).toBeNull();
    unmount();
    mount({ gamingSlot: <div data-testid="gaming-slot" /> });
    fireEvent.click(screen.getByRole("tab", { name: "Gaming Mode" }));
    expect(screen.getByTestId("gaming-slot")).toBeTruthy();
  });
});
