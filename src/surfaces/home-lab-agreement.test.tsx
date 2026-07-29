import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { HomeRoom } from "./HomeRoom";
import { OptimizeStation, type LabFastPathProps } from "./lab/OptimizeStation";
import { ShellV2 } from "../design/ShellV2";
import { ConfirmProvider } from "../design/ConfirmDialog";
import { railFor } from "../design/homeRail";
import { homeIntakeFastpath, fastPathReadyHeadline as fastPathReadyHeadlineRaw } from "./home-intake-data";
import { prewarmScan } from "./use-scan";
import { peekProbe } from "../data/probe-cache";
import i18n from "../i18n";
import type { GameReadiness, Priorities, Recommendation, SessionSummary } from "../types";
import type { HardwareInfo } from "../App";

// bug→guard (self-review round 9, 2026-07-29). Round 8 fixed the dismissal drift WITHIN the Lab
// (one module-level set, guarded by optimize-gauge-dock-guard.test.tsx). Round 9 found the same
// class one layer up, ACROSS rooms: set "Enable Windows Game Mode" aside in the Lab, walk to Home,
// and Home still said "1 to fix · 1 worth fixing · TOP LIMITER: Enable Windows Game Mode — See in
// Lab". Tap through and the row isn't there. The reviewer's fix list asked for exactly this file:
// "Add a live-journey guard test spanning Home → Lab (not just within-Lab surfaces) so this class
// of drift trips CI next time."
//
// Home makes its claim through TWO independent channels, so this guards both:
//   1. the intake band's one-tap stack — pure frontend, derived from `recs` via safeFixesReadyList;
//   2. "N worth fixing" / "TOP LIMITER" — the RUST priorities ranker, reached over `priorities_from`.
// Channel 2 can't be re-ranked in jsdom, so what's guarded here is the joint: the set-asides reach
// the ranker's input, and a dismissal drops the cached scan that would otherwise re-seed the old
// ranking. What the ranker then DOES with them is pinned in Rust (priorities.rs — Rule 8 tests
// `a_set_aside_rec_stops_being_a_limiter` and `set_asides_never_hide_a_real_measurement`).

const ipc = vi.hoisted(() => ({ calls: [] as { cmd: string; args?: Record<string, unknown> }[] }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => {
    ipc.calls.push({ cmd, args });
    switch (cmd) {
      case "get_game_readiness":
        return Promise.resolve(readiness);
      case "get_recommendations":
        return Promise.resolve([gameMode]);
      case "priorities_from":
        return Promise.resolve(priorities);
      case "get_applied_changes":
      case "get_startup_entries":
      case "get_session_summaries":
      case "get_gpu_sensors":
        return Promise.resolve([]);
      case "get_build_stamp":
        return Promise.resolve("ab12cd3 · dev");
      case "get_memory_pressure":
        return Promise.resolve({ used_bytes: 1, total_bytes: 2, level: "ok" });
      default:
        return Promise.resolve(null);
    }
  },
}));

vi.mock("./rig/RigHologram", () => ({ RigHologram: () => <div data-testid="rig-hologram" /> }));

beforeAll(() => {
  class Obs {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (globalThis as Record<string, unknown>).ResizeObserver ??= Obs;
  (globalThis as Record<string, unknown>).IntersectionObserver ??= Obs;
});

// Dismissals persist in localStorage AND in the module-level store behind useDismissed — clear the
// storage and let the 0-subscriber remount re-read it, so no test inherits another's set-asides.
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
  ipc.calls.length = 0;
});

const FASTPATH = homeIntakeFastpath(i18n.t);
const readyHeadline = (n: number) => fastPathReadyHeadlineRaw(n, i18n.t);

// ONE rec, shared by both rooms on purpose — the whole point is that the two surfaces are looking
// at the same catalog and must reach the same answer about it.
const gameMode: Recommendation = {
  id: "game-mode",
  title: "Enable Windows Game Mode",
  category: "system",
  severity: "safe",
  description: "d",
  impact: "i",
  downside: null,
  applies_to: "all",
  currently_applied: false,
  provenance: "verified",
  eligible: true,
} as Recommendation;

const readiness: GameReadiness = {
  checks: [{ id: "a", label: "A", status: "ready", detail: "", value: null }],
  ready_count: 1,
  attention_count: 0,
  unknown_count: 0,
  advisory_count: 0,
  advisory: "",
  dismissed_ids: [],
  drifts: [],
};

const priorities: Priorities = {
  limiters: [],
  already_fine: [],
  not_worth_touching: [],
  session_hint: null,
  upgrade_path: null,
};

const hw = {
  cpu_brand: "AMD Ryzen 7 9850X3D",
  cpu_arch: { family_label: "Ryzen 7 9850X3D", architecture: "Zen 5", generation: "9000" },
  cpu_cores_logical: 16,
  cpu_cores_physical: 8,
  cpu_frequency_mhz: 5100,
  ram_total_bytes: 32 * 1024 ** 3,
  ram_used_bytes: 16 * 1024 ** 3,
  gpus: [{ name: "AMD Radeon RX 9070 XT", vram_bytes: 16 * 1024 ** 3 }],
  disks: [],
  memory_modules: [],
  physical_disks: [],
  display: { current_refresh_rate_hz: 165 },
  os_name: "Windows",
  os_version: "11",
} as unknown as HardwareInfo;

const fast: LabFastPathProps = {
  recs: [gameMode] as never[],
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
  sessions: [] as SessionSummary[],
  gpus: [],
  vendor: "amd",
};

const liveRooms = railFor(true, true)
  .filter((r) => r.id !== "home")
  .map((r) => ({ key: r.id, name: r.label }));

// Walk the REAL decline path a user walks in the Lab: open the first slim row, press "Not for me".
// Nothing here reaches into state — if the control moves or the wiring breaks, this breaks.
const setAsideFirstRow = (container: HTMLElement) => {
  fireEvent.click(container.querySelector(".slimrow-toggle") as HTMLButtonElement);
  const notForMe = [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Not for me"),
  ) as HTMLButtonElement;
  expect(notForMe).toBeTruthy();
  fireEvent.click(notForMe);
};

// Both rooms in ONE tree so a decline in the Lab has to be visible to Home without a remount —
// which is the live condition (the rail swaps rooms inside one running app, it doesn't reload).
function renderBoth() {
  localStorage.setItem("compy_home_intake", "1");
  return render(
    <ConfirmProvider>
      <ShellV2
        items={railFor(true, true)}
        activeId="home"
        onNavigate={() => {}}
        ledgerCount={0}
        version="0.1.0"
      >
        <HomeRoom
          hw={hw}
          readiness={readiness}
          priorities={priorities}
          sessions={[]}
          changes={[]}
          onRunCheck={() => {}}
          onSeeInFix={() => {}}
          rooms={liveRooms}
          recs={[gameMode]}
          isAppliable={() => true}
          onApplyBatch={async () => ({ applied: 0, skipped: [] })}
        />
        <OptimizeStation {...fast} />
      </ShellV2>
    </ConfirmProvider>,
  );
}

describe("Home ↔ Lab agreement: a rec declined in the Lab is gone from Home's one-tap band", () => {
  it("Home stops counting — and stops OFFERING to apply — the tweak the user just declined", () => {
    const { container } = renderBoth();
    const band = () => container.querySelector(".hc-intake-fast")!.textContent!;

    // Before: both rooms agree there is exactly one thing to do.
    expect(band()).toContain(readyHeadline(1));
    expect(container.querySelector(".hc-intake-fast-btn")).not.toBeNull();
    expect(container.querySelector(".lab-gauge-caption")!.textContent).toContain(
      "1 left to enable below",
    );

    setAsideFirstRow(container);

    // After: still agreed, in the same render. The band must not merely stop counting it — the
    // apply BUTTON has to go too, or Home is still offering to turn on a tweak the user declined.
    expect(band()).toContain(FASTPATH.allClear);
    expect(band()).not.toContain(readyHeadline(1));
    expect(container.querySelector(".hc-intake-fast-btn")).toBeNull();
    expect(container.querySelector(".lab-gauge-caption")!.textContent).toContain(
      "Nothing waiting — the last one is set aside.",
    );
  });

  it("Home never names the declined tweak as work anywhere in the band", () => {
    const { container } = renderBoth();
    setAsideFirstRow(container);
    // The catalog title may legitimately appear in receipt/history surfaces — but not in the band
    // whose entire job is "here is what's left to do".
    expect(container.querySelector(".hc-intake-fast")!.textContent).not.toContain(
      "Enable Windows Game Mode",
    );
  });

  it("restoring it in the Lab brings Home's offer back (the decline is reversible, both ways)", () => {
    const { container } = renderBoth();
    setAsideFirstRow(container);
    expect(container.querySelector(".hc-intake-fast-btn")).toBeNull();

    // The way back is a real journey too: open the "Dismissed" door (collapsed by default outside
    // expert view), then press that row's Restore.
    const door = [...container.querySelectorAll(".fix-group-head")].find((b) =>
      b.textContent?.includes("Dismissed"),
    ) as HTMLButtonElement | undefined;
    expect(door).toBeTruthy();
    fireEvent.click(door!);
    const restore = [...container.querySelectorAll("button.fix-restore")].find(
      (b) => b.textContent === "Restore",
    ) as HTMLButtonElement | undefined;
    expect(restore).toBeTruthy();
    fireEvent.click(restore!);

    expect(container.querySelector(".hc-intake-fast")!.textContent).toContain(readyHeadline(1));
    expect(container.querySelector(".hc-intake-fast-btn")).not.toBeNull();
  });
});

describe("Home ↔ Lab agreement: the ranker behind 'worth fixing' / 'TOP LIMITER' hears the decline", () => {
  // The literal key use-scan.ts caches its scan under (SCAN_KEY is module-private there).
  const SCAN_KEY = "readiness-scan";

  it("a decline invalidates the cached scan and reaches priorities_from on the next one", async () => {
    const { container } = renderBoth();
    const rankCalls = () => ipc.calls.filter((c) => c.cmd === "priorities_from");
    const lastRank = () => {
      const calls = rankCalls();
      return calls[calls.length - 1];
    };

    await prewarmScan();
    expect(rankCalls().length).toBeGreaterThanOrEqual(1);
    expect(lastRank().args!.dismissedIds).toEqual([]);
    expect(peekProbe(SCAN_KEY)).toBeTruthy();

    setAsideFirstRow(container);

    // The cached scan was ranked against the OLD set-asides — leaving it in place is exactly how
    // re-opening Check re-seeded "TOP LIMITER: <the tweak you just declined>".
    expect(peekProbe(SCAN_KEY)).toBeUndefined();

    await prewarmScan();
    expect(lastRank().args!.dismissedIds).toEqual(["game-mode"]);
  });

  it("with nothing declined, the ranker is handed an empty set (negative control)", async () => {
    renderBoth();
    await prewarmScan();
    const ranked = ipc.calls.filter((c) => c.cmd === "priorities_from");
    expect(ranked[ranked.length - 1].args!.dismissedIds).toEqual([]);
    // …and the readiness/recs probes are still the real ones — the set-asides ride ALONGSIDE the
    // measurement, they never filter what Compy measured (honesty law; pinned in Rust too).
    expect(ipc.calls.some((c) => c.cmd === "get_game_readiness")).toBe(true);
    expect(ipc.calls.some((c) => c.cmd === "get_recommendations")).toBe(true);
  });
});
