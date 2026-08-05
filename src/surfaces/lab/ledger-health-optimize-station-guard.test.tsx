// bug → guard, the LAST known open instance of the ledger-completeness class (Optimize/Fix closed by
// `b60a314`/`a1d5f53`, the Blackbook Logbook by `61e092c`, the Benchmark tab by `4150eb3`, Home by
// `95eb92a`/`3808b00`). Issue #70; #67's deliberately-unticked box.
//
// `get_applied_changes` degrades a Trust Ledger it cannot READ to an empty array. The Lab's Optimize
// station wraps the record half of the room in a disclosure whose summary reads:
//
//     Applied & history — every change, undoable
//
// That is an absolute promise about a set Compy may never have enumerated.
//
// What makes THIS instance different from its five siblings, and why the naive framing gets it wrong:
// the disclosure is NOT un-gated. `Fix` mounts `LedgerHealthNotice` for view="ledger"
// (src/surfaces/Fix.tsx:1316) and already withholds its `.fix-empty` machine claim when the ledger is
// known-incomplete (:1353). The amber notice therefore DOES render — inside the `<details>` body. The
// residual defect is the `<summary>` line alone: the claim sits OUTSIDE and ABOVE the container that
// holds its own caveat, and that container is collapsed by default whenever expert view is off. So the
// caveat is sealed behind the very claim it qualifies — the same ordering failure
// `src/surfaces/ledger-health-disclosure-guard.test.tsx` pins for the siblings: a caveat printed under
// the thing it qualifies has already failed at its job. Sealed behind a click is worse than under.
//
// Hence two assertions per incomplete shape, not one: the vouch is withdrawn AND the section opens
// itself. Both incomplete shapes are pinned — transient (load_history() failing right now → `error`)
// and durable (quarantined on an earlier run, so every later load returns Ok(vec![]) forever,
// byte-identical to a genuine first run). And the case that is NOT a defect: health UNKNOWN (the probe
// itself failed or answered nothing) must leave the station EXACTLY as it was, byte for byte —
// manufacturing a warning out of a read that failed is the same sin, mirrored.
//
// No narrowing applies to the count here. Unlike Home's readings, the summary carries no number: it is
// an absolute, and an absolute is falsified by either incomplete shape at ANY count. So the swap is
// health-gated, never count-gated — pinned at zero changes and at one.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import type { AppliedChange } from "../../types";

const health: { value: unknown; reject: boolean } = { value: null, reject: false };

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_ledger_health") {
      return health.reject ? Promise.reject(new Error("ipc down")) : Promise.resolve(health.value);
    }
    return Promise.resolve(null);
  }),
}));

// Reduced motion → the gauge snaps instead of tweening (use-count-to.ts:33), which is what makes the
// byte-identity failsafe below deterministic rather than a race against GSAP.
vi.mock("../../design/use-motion", () => ({ useReducedMotion: () => true }));

const { OptimizeStation } = await import("./OptimizeStation");
const { ConfirmProvider } = await import("../../design/ConfirmDialog");
import type { LabFastPathProps } from "./OptimizeStation";

const HEALTHY = { complete: true, error: null, quarantined: false };
const UNREADABLE = { complete: false, error: "failed to read history.json", quarantined: false };
const QUARANTINED = { complete: false, error: null, quarantined: true };

const VOUCH = "every change, undoable";
const UNVOUCHED = "Compy can't promise every change here can be undone";
const UNREADABLE_TITLE = "Compy can't read its own record right now";
const QUARANTINED_TITLE = "Compy can't tell you everything it did";

// Same fixture the station's other guard uses (optimize-gauge-dock-guard.test.tsx) — one safe,
// appliable rec so the hero and its gauge render the ordinary way.
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

const CHANGE = {
  id: "ch1",
  rec_id: "hags-enable",
  rec_title: "Hardware-accelerated GPU scheduling",
  applied_at: "2026-06-28T18:22:00Z",
  snapshot: null,
  status: "applied",
  is_still_active: true,
} as unknown as AppliedChange;

async function mount(changes: AppliedChange[] = []) {
  const r = render(
    <ConfirmProvider>
      <OptimizeStation {...fast} changes={changes} />
    </ConfirmProvider>,
  );
  // Flush the station's probe and the one Fix runs inside the disclosure. The `act()` wrapper is load-
  // bearing, not decoration: `useLedgerHealth` sets state from a promise `.then()`, and React 18 will
  // not commit that outside act — a bare `await Promise.resolve()` leaves every assertion below reading
  // the pre-probe render and passing for the wrong reason.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return r;
}

// Reads the claim off the ELEMENT that carries it, not off a page substring: a substring matcher keeps
// passing after the summary is reworded, which is exactly the failure this file exists to catch.
function summary(container: HTMLElement): HTMLElement {
  const details = container.querySelector<HTMLDetailsElement>(".lab-optimize-ledger");
  if (!details) {
    throw new Error(
      "no `.lab-optimize-ledger` disclosure — the anchor moved, which is not the bug this file guards",
    );
  }
  const s = details.querySelector<HTMLElement>(".lab-optimize-more-summary");
  if (!s) throw new Error("`.lab-optimize-ledger` has no summary — anchor moved");
  return s;
}

function disclosure(container: HTMLElement): HTMLDetailsElement {
  return container.querySelector<HTMLDetailsElement>(".lab-optimize-ledger")!;
}

beforeEach(() => {
  health.value = HEALTHY;
  health.reject = false;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe.each([
  ["quarantined", QUARANTINED, QUARANTINED_TITLE],
  ["unreadable", UNREADABLE, UNREADABLE_TITLE],
])(
  "the Optimize station may not vouch for a %s ledger",
  (_shape, value, title) => {
    it.each([
      ["an empty list", [] as AppliedChange[]],
      ["a partial list", [CHANGE]],
    ])("withdraws the undo promise on %s — the swap is health-gated, not count-gated", async (_case, changes) => {
      health.value = value;
      const { container } = await mount(changes);

      expect(summary(container).textContent).toContain(UNVOUCHED);
      expect(summary(container).textContent).not.toContain(VOUCH);
      // Gone from the WHOLE station, not just from that line.
      expect(container.textContent).not.toContain(VOUCH);
    });

    it("opens the disclosure, so the caveat is not sealed behind the claim it qualifies", async () => {
      health.value = value;
      const { container } = await mount();

      const details = disclosure(container);
      expect(details.open).toBe(true);

      // The notice lives INSIDE this disclosure — that containment is the whole reason `open` has to
      // be forced. If it ever moves out, forcing `open` stops being the fix and this pin should fail.
      const box = details.querySelector(".ledger-health");
      expect(box).toBeTruthy();
      expect(box!.textContent).toContain(title);
      // One notice, once. Two would read as two separate problems (only Fix view="ledger" mounts it;
      // the hero's view="fixes" Fix must not — Fix.tsx:931,1316).
      expect(container.querySelectorAll(".ledger-health").length).toBe(1);
    });
  },
);

describe("a healthy ledger is left exactly as it was", () => {
  it("keeps the vouch and stays collapsed — expert view is still the only thing that opens it", async () => {
    const { container } = await mount();

    expect(summary(container).textContent).toContain(VOUCH);
    expect(summary(container).textContent).not.toContain(UNVOUCHED);
    // Collapsed on a healthy ledger is the control for the test above: without it, "open under
    // incomplete" would pass just as well on a disclosure that is always open.
    expect(disclosure(container).open).toBe(false);
    expect(container.querySelector(".ledger-health")).toBeNull();
  });

  it("expert view still opens it, and the health gate did not take that over", async () => {
    localStorage.setItem("compy_expert_view", "1");
    const { container } = await mount();

    expect(disclosure(container).open).toBe(true);
    expect(summary(container).textContent).toContain(VOUCH);
  });
});

describe("UNKNOWN health is not incompleteness", () => {
  it.each([
    ["a probe that REJECTS", () => (health.reject = true)],
    ["a probe that resolves NOTHING", () => (health.value = null)],
  ])("%s leaves the station BYTE-IDENTICAL to a healthy ledger", async (_name, degrade) => {
    // Warm-up mount, discarded. `Check` — in the sibling "More cleanup" disclosure, nothing to do with
    // the ledger — caches its rig scan at module level, so the FIRST mount in this file renders
    // "Scanning your rig…" and every later one renders the settled result. Priming it here keeps the
    // comparison below about the ledger and only the ledger.
    await mount();
    cleanup();

    const healthy = (await mount()).container.innerHTML;
    cleanup();

    degrade();
    const unknown = (await mount()).container.innerHTML;

    expect(unknown).toBe(healthy);
  });

  it("a ledger that reports itself COMPLETE is left alone — complete:true is the backend vouching", async () => {
    const { container } = await mount([CHANGE]);

    expect(summary(container).textContent).toContain(VOUCH);
    expect(container.querySelector(".ledger-health")).toBeNull();
  });
});
