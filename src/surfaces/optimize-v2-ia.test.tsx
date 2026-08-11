import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

// V2-4b IA guards (spec 2026-07-03-owner-optimize-feedback, bug→guard tier 1):
//   1. ONE-MENTION LAW — a rec renders as an actionable row exactly once per room. The owner
//      caught Game Mode 3× (drift card + "tweak(s) not applied" aggregate + worth-making row);
//      these pin the drifted-rec single row and the suppressed aggregates.
//   2. CLASSIC BYTE-IDENTITY — without v2Ia, Check and Fix render exactly the classic sections
//      (suppressing anything there would change the shipped flag-off app).
//   3. Relocations — setup summary leaves the v2 fixes flow; driver freshness renders only when
//      something stale was measured; upgrade path carries the early label.

const prioritiesMock = vi.hoisted(() => ({
  payload: {
    limiters: [],
    already_fine: [],
    not_worth_touching: [],
    session_hint: null,
    upgrade_path: null,
  } as Record<string, unknown>,
}));

// useScan runs real commands on mount — feed it a settled scan. get_applied_changes drives
// deriveReverted (the drift list): game-mode applied then no-longer-active = drifted.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_game_readiness")
      return Promise.resolve({
        checks: [{ id: "a", label: "SSD check", status: "ready", detail: "", value: null }],
        ready_count: 1,
        attention_count: 0,
        unknown_count: 0,
        advisory_count: 0,
        advisory: "",
        dismissed_ids: [],
        drifts: [],
      });
    if (cmd === "priorities_from") return Promise.resolve(prioritiesMock.payload);
    if (cmd === "get_recommendations") return Promise.resolve([]);
    if (cmd === "get_applied_changes")
      return Promise.resolve([
        {
          id: "c1",
          rec_id: "game-mode",
          rec_title: "Enable Windows Game Mode",
          applied_at: "2026-06-28T18:00:00Z",
          snapshot: null,
          status: "applied",
          is_still_active: false,
        },
      ]);
    if (cmd === "get_nic_driver_info") return Promise.resolve([]);
    return Promise.resolve(null);
  }),
}));

import Check from "./Check";
import Fix from "./Fix";
import { ConfirmProvider } from "../design/ConfirmDialog";
import { invalidateProbe } from "../data/probe-cache";
import type { AppliedChange } from "../types";

afterEach(() => {
  cleanup();
  localStorage.clear();
  invalidateProbe(); // the scan cache must not leak one test's payload into the next
  prioritiesMock.payload = {
    limiters: [],
    already_fine: [],
    not_worth_touching: [],
    session_hint: null,
    upgrade_path: null,
  };
});

// ── Fix fixtures ──
const rec = (id: string, title: string, over: Record<string, unknown> = {}) => ({
  id,
  title,
  description: "",
  impact: "",
  currently_applied: false,
  provenance: "verified" as const,
  severity: "safe" as const,
  ...over,
});
const RECS = [
  rec("game-mode", "Enable Windows Game Mode"),
  rec("hags-enable", "Hardware-accelerated GPU scheduling"),
  rec("gpu-driver", "Update your GPU driver", { severity: "moderate" }), // guided (not appliable)
];
const APPLIABLE = new Set(["game-mode", "hags-enable"]);
const CHANGES: AppliedChange[] = [
  {
    id: "c1",
    rec_id: "game-mode",
    rec_title: "Enable Windows Game Mode",
    applied_at: "2026-06-28T18:00:00Z",
    snapshot: null,
    status: "applied",
    is_still_active: false,
  } as AppliedChange,
];

function mountFix(over: Record<string, unknown> = {}) {
  const props = {
    recs: RECS,
    startup: [],
    changes: CHANGES,
    busyId: null,
    isAppliable: (id: string) => APPLIABLE.has(id),
    activeChangeFor: () => undefined,
    onToggleRec: vi.fn(),
    onToggleStartup: vi.fn(),
    onRollback: vi.fn(),
    onApplyBatch: vi.fn().mockResolvedValue({ applied: 0, skipped: [] }),
    onOpenLibrary: vi.fn(),
    vendor: "amd" as const,
    view: "fixes" as const,
    ...over,
  };
  return { ...render(<Fix {...props} />), props };
}

// Count the actionable rows whose title matches — the one-mention law's unit of measure.
const rowsTitled = (container: HTMLElement, title: string) =>
  [...container.querySelectorAll(".fix-list li")].filter((li) =>
    li.textContent?.includes(title),
  ).length;

describe("Fix — V2-4b one-mention grouping", () => {
  it("a drifted rec renders EXACTLY ONE actionable row, in the drifted group, not under ready", () => {
    const { container } = mountFix({
      v2Ia: true,
      reverted: [{ rec_id: "game-mode", title: "Enable Windows Game Mode" }],
    });
    expect(rowsTitled(container, "Enable Windows Game Mode")).toBe(1);
    expect(screen.getByText("Applied — turned off outside Compy")).toBeTruthy();
    // The non-drifted one-click rec stays under ready.
    expect(screen.getByText("Ready — one click, reversible")).toBeTruthy();
    expect(rowsTitled(container, "Hardware-accelerated GPU scheduling")).toBe(1);
    // The guided rec is an elevated open group now, not a collapsed drawer.
    expect(screen.getByText("Needs your call")).toBeTruthy();
    expect(screen.queryByText(/Compy points the way/)).toBeNull();
  });

  it("drift state is an attribute, not extra rows: no drift → no drifted group, rec under ready once", () => {
    const { container } = mountFix({ v2Ia: true, reverted: [] });
    expect(screen.queryByText("Applied — turned off outside Compy")).toBeNull();
    expect(rowsTitled(container, "Enable Windows Game Mode")).toBe(1);
  });

  it("CLASSIC byte-identity: without v2Ia the classic sections render exactly as before", () => {
    const { container } = mountFix();
    expect(screen.getByText("Worth making for your rig")).toBeTruthy();
    expect(screen.queryByText("Ready — one click, reversible")).toBeNull();
    expect(screen.queryByText("Applied — turned off outside Compy")).toBeNull();
    expect(screen.getByText(/Compy points the way/)).toBeTruthy();
    expect(screen.queryByText("Needs your call")).toBeNull();
    expect(rowsTitled(container, "Enable Windows Game Mode")).toBe(1);
  });
});

// ── Check fixtures ──
const LIMITERS = [
  {
    id: "pending-safe-recs",
    title: "2 safe one-click tweak(s) not applied",
    reason: "Compy has safe, reversible tweaks you haven't applied.",
    linked: null,
    confidence: "medium",
    status: "attention",
  },
  {
    id: "applied-changes",
    title: "Applied Compy changes",
    reason: "1 setting drifted.",
    linked: null,
    confidence: "high",
    status: "attention",
  },
  {
    id: "disk-full",
    title: "C: drive is 87% full",
    reason: "Below ~10% free, load times measurably suffer.",
    linked: null,
    confidence: "high",
    status: "attention",
  },
];

function mountCheck(over: Record<string, unknown> = {}) {
  return render(
    <ConfirmProvider>
      <Check
        isAppliable={() => false}
        onOpenLibrary={vi.fn()}
        onChanged={vi.fn()}
        vendor="amd"
        embedded
        {...over}
      />
    </ConfirmProvider>,
  );
}

describe("Check — V2-4b suppressions and relocations", () => {
  it("v2Ia: the rec-aggregate limiters are suppressed (their state lives on Fix's rows); real limiters stay", async () => {
    prioritiesMock.payload = { ...prioritiesMock.payload, limiters: LIMITERS };
    mountCheck({ v2Ia: true });
    expect(await screen.findByText("C: drive is 87% full")).toBeTruthy();
    expect(screen.queryByText(/tweak\(s\) not applied/)).toBeNull();
    expect(screen.queryByText(/turned itself back off/)).toBeNull();
  });

  it("classic: the same payload renders the aggregate limiter + the named drift card (flag-off unchanged)", async () => {
    prioritiesMock.payload = { ...prioritiesMock.payload, limiters: LIMITERS };
    mountCheck();
    expect(await screen.findByText("C: drive is 87% full")).toBeTruthy();
    // (getAll: the classic setup summary also lists the limiter titles in its recap text.)
    expect(screen.getAllByText(/tweak\(s\) not applied/).length).toBeGreaterThanOrEqual(1);
    // The applied-changes limiter renders as the named drifted-setting card (reverted nonempty).
    expect(screen.getByText(/turned itself back off/)).toBeTruthy();
  });

  it("v2Ia: setup summary leaves the fixes flow (it renders on Applied via OptimizeV2)", async () => {
    mountCheck({ v2Ia: true });
    expect(await screen.findByText(/All 1 checks/)).toBeTruthy();
    expect(screen.queryByText("Setup summary")).toBeNull();
  });

  it("classic: setup summary still renders with the scan results", async () => {
    mountCheck();
    expect(await screen.findByText("Setup summary")).toBeTruthy();
  });

  it("v2Ia: a recent driver renders NO freshness card; classic still shows the pass fact", async () => {
    const gpus = [{ name: "AMD Radeon RX 9070 XT", driver_age_days: 5 }];
    mountCheck({ v2Ia: true, gpus });
    expect(await screen.findByText(/All 1 checks/)).toBeTruthy();
    expect(screen.queryByText("Driver freshness")).toBeNull();
    cleanup();
    mountCheck({ gpus });
    expect(await screen.findByText("Driver freshness")).toBeTruthy();
    expect(screen.getByText(/Driver is recent/)).toBeTruthy();
  });

  it("v2Ia: a stale driver still earns its ONE quiet advisory row", async () => {
    const gpus = [{ name: "AMD Radeon RX 9070 XT", driver_age_days: 200 }];
    mountCheck({ v2Ia: true, gpus });
    expect(await screen.findByText("Driver freshness")).toBeTruthy();
    expect(screen.getByText(/200 days old/)).toBeTruthy();
  });

  it("v2Ia: Check suppresses the upgrade path — demoted content never LEADS the room (OptimizeV2 re-renders it below the groups)", async () => {
    prioritiesMock.payload = {
      ...prioritiesMock.payload,
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
    };
    mountCheck({ v2Ia: true });
    expect(await screen.findByText(/All 1 checks/)).toBeTruthy();
    expect(screen.queryByText("GPU was the measured limiter")).toBeNull();
    cleanup();
    mountCheck();
    expect(await screen.findByText("GPU was the measured limiter")).toBeTruthy();
  });
});

describe("Check — V2-4b stacked-summary suppression", () => {
  it("v2Ia: the settled scan subtitle is gone (the RoomShell verdict owns the summary line)", async () => {
    mountCheck({ v2Ia: true });
    await screen.findByText(/All 1 checks/);
    expect(document.querySelector(".check-sub")).toBeNull();
  });

  // findByRole recomputes the whole accessibility tree on every retry, and blew past testing
  // -library's 1s default under a loaded parallel run — this single test failed an otherwise green
  // pre-push gate on 2026-08-11 while passing in isolation. A flaky gate is worse than a slow one:
  // it teaches you to reach for --no-verify. The label is reached by findByText here, exactly as
  // the sibling tests above already do, and closest("button") keeps the claim this test is named
  // for — the toggle is still a real button, not a bare span.
  it("expanding 'All N checks' still works with the sub gone (chrome intact)", async () => {
    mountCheck({ v2Ia: true });
    const toggle = (await screen.findByText(/All 1 checks/)).closest("button");
    if (!toggle) throw new Error("'All N checks' is no longer inside a button — the chrome is gone");
    fireEvent.click(toggle);
    expect(screen.getByText("SSD check")).toBeTruthy();
  });
});
