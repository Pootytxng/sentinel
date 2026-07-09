import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { readLabGround, applyLabGround } from "../design/theme";

// Guard for phase 1 of the Lab overhaul (spec 2026-07-08-lab-proving-ground): the merged
// proving-ground room behind `compy_lab_ground` (DEFAULT OFF). The flag lives at the App level —
// App swaps LabV2 → LabGround for the Lab tab — so the byte-identity contract has TWO parts:
//   1. the flag defaults OFF (readLabGround), and
//   2. Lab.tsx's new `ground` mode is purely additive — Lab WITHOUT the prop renders identically
//      regardless of the compy_lab_ground value (Lab.tsx never reads the flag; only App does), so
//      the whole flag-off app stays byte-identical.
// Plus: `ground` mode renders the ONE linear spine (router + numbered stations) and NONE of the
// three retired nav idioms (bento / guided-welcome / classic accordion / readings strip).

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

// RoomShell's verdict animates via DecryptedText (animateOn="view") → IntersectionObserver, which
// jsdom lacks. A no-op stub lets the merged room mount; the text is the pure helper's real output.
class IOStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
vi.stubGlobal("IntersectionObserver", IOStub);

// Imported after the mock so their on-mount probe reads hit the stub.
const { default: Lab } = await import("./Lab");
const { LabGround } = await import("./LabGround");
const { ConfirmProvider } = await import("../design/ConfirmDialog");

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  // Pin the other Lab flags to fixed values so only the variable under test moves.
  localStorage.setItem("compy_lab_bento", "0");
  localStorage.setItem("compy_lab_guided", "0");
});

const renderClassic = () =>
  render(<Lab v2 vendor="amd" diagnostics={<div data-testid="diag" />} diagnosticsCaptured />)
    .container;

const renderGround = () =>
  render(
    <Lab v2 ground vendor="amd" diagnostics={<div data-testid="diag" />} diagnosticsCaptured />,
  ).container;

describe("compy_lab_ground flag reader", () => {
  it("defaults OFF (absent → false)", () => {
    localStorage.removeItem("compy_lab_ground");
    expect(readLabGround()).toBe(false);
  });

  it("'1' → true, '0' → false; applyLabGround round-trips", () => {
    applyLabGround(true);
    expect(readLabGround()).toBe(true);
    expect(localStorage.getItem("compy_lab_ground")).toBe("1");
    applyLabGround(false);
    expect(readLabGround()).toBe(false);
  });
});

describe("Lab `ground` mode is additive — flag-off byte-identity", () => {
  it("classic Lab (no ground prop) is byte-identical regardless of compy_lab_ground value", () => {
    // Lab.tsx must never read the flag itself — App owns the swap. Prove it: the classic render is
    // identical whether the flag is absent, '0', or '1'.
    localStorage.removeItem("compy_lab_ground");
    const absent = renderClassic().innerHTML;
    cleanup();
    localStorage.setItem("compy_lab_ground", "0");
    const off = renderClassic().innerHTML;
    cleanup();
    localStorage.setItem("compy_lab_ground", "1");
    const on = renderClassic().innerHTML;
    expect(off).toBe(absent);
    expect(on).toBe(absent);
  });
});

describe("Lab `ground` mode renders the ONE linear spine", () => {
  it("front door (router) + numbered stations present; the three old idioms absent", () => {
    const c = renderGround();
    // The intake router leads the room.
    expect(c.querySelector(".lab-router")).not.toBeNull();
    // Numbered stations (the linear spine) — at least one station number rendered.
    expect(c.querySelector(".lab-station-num")).not.toBeNull();
    expect(c.querySelector(".lab-station-lines")).not.toBeNull();
    // The ground marker on the root, and NOT the bento/guided markers.
    expect(c.querySelector("[data-ground]")).not.toBeNull();
    expect(c.querySelector("[data-bento]")).toBeNull();
    // None of the retired faces: bento grid, welcome band, classic-only readings strip.
    expect(c.querySelector(".lab-bento")).toBeNull();
    expect(c.querySelector(".lab-welcome")).toBeNull();
    expect(c.querySelector(".lab-readings")).toBeNull();
  });

  it("ground overrides even a default-ON bento flag (proving-ground is the single idiom)", () => {
    localStorage.setItem("compy_lab_bento", "1"); // bento would normally paint
    const c = renderGround();
    expect(c.querySelector(".lab-bento")).toBeNull();
    expect(c.querySelector(".lab-router")).not.toBeNull();
  });
});

describe("LabGround INSTRUMENT BENCH — LabBench replaces the linear spine (spec 2026-07-09)", () => {
  // The Instrument Bench (Phase 1) swaps the linear numbered spine for a bento grid of station
  // bays. These guards pin (a) the old seam classes stay GONE, (b) with tweaks present the HERO bay
  // is station 1 "Optimize" (inline), (c) the empty/no-recs case degrades to the measure bays only
  // with no crash, and (d) the RoomShell verdict + no-Gallery invariants hold through the swap.
  const SAFE_REC = {
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
  } as never;

  const renderMerged = (recs: never[] = [], gamingEnabled = false) =>
    render(
      <ConfirmProvider>
      <LabGround
        isAppliable={() => true}
        onOpenLibrary={() => {}}
        onChanged={() => {}}
        vendor="amd"
        sessions={[]}
        gpus={[]}
        recs={recs}
        startup={[]}
        changes={[]}
        busyId={null}
        activeChangeFor={() => undefined}
        onToggleRec={() => {}}
        onToggleStartup={() => {}}
        onRollback={() => {}}
        onApplyBatch={async () => ({ applied: 0, skipped: [] })}
        gamingEnabled={gamingEnabled}
        readiness={null}
        activeCount={0}
        diagnostics={<div data-testid="diag" />}
        diagnosticsCaptured
      />
      </ConfirmProvider>,
    ).container;

  it("the rejected seam is gone — no `.lg-fast` / `.lg-utility` boxes anywhere", () => {
    const c = renderMerged([SAFE_REC]);
    expect(c.querySelector(".lg-fast")).toBeNull();
    expect(c.querySelector(".lg-utility")).toBeNull();
    expect(c.querySelector(".lg-utility-kicker")).toBeNull();
  });

  it("with tweaks present, the HERO bay is station 1 'Optimize' (inline); verdict present", () => {
    const c = renderMerged([SAFE_REC]);
    // The hero bay is Optimize, rendered inline as the dominant bay.
    expect(c.querySelector(".lab-bench-hero")).not.toBeNull();
    expect(c.querySelector(".lab-bench-hero-name")!.textContent).toBe("Optimize");
    // The measure/prove stations render as compact door bays around it.
    const measure = Array.from(c.querySelectorAll(".lab-bench-name")).map((n) => n.textContent);
    expect(measure).toEqual(["Diagnostics", "Benchmark", "Latency", "Tuning", "Black Box"]);
    // One idiom: the retired linear-spine + bento faces stay absent.
    expect(c.querySelector(".lab-router")).toBeNull();
    expect(c.querySelector(".lab-bento")).toBeNull();
    expect(c.querySelector(".lab-welcome")).toBeNull();
    // RoomShell verdict present.
    expect(c.querySelector(".v2-room[data-room='lab']")).not.toBeNull();
  });

  it("empty state (no recs): no hero bay — just the measure bays, no throw, verdict present", () => {
    const c = renderMerged();
    // No tweaks to offer → no hero bay; the bench degrades to the measure doors only.
    expect(c.querySelector(".lab-bench-hero")).toBeNull();
    const measure = Array.from(c.querySelectorAll(".lab-bench-name")).map((n) => n.textContent);
    expect(measure).toEqual(["Diagnostics", "Benchmark", "Latency", "Tuning", "Black Box"]);
    // The bench grid + verdict are still present; no retired idioms.
    expect(c.querySelector(".lab-bench-grid")).not.toBeNull();
    expect(c.querySelector(".lab-bento")).toBeNull();
    expect(c.querySelector(".lab-welcome")).toBeNull();
    expect(c.querySelector(".v2-room[data-room='lab']")).not.toBeNull();
  });

  it("§5 Power-features bay shows in station 1 ONLY when Gaming Mode is armed; the bay stays collapsed (Gaming Mode lazy-mounts)", () => {
    // Armed → the read-first Power-features disclosure is offered in station 1 (Gaming Mode +
    // service-suspend, provable in the Lab). Closed by default so Gaming Mode never mounts/polls
    // until opened.
    const armed = renderMerged([SAFE_REC], true);
    const summaries = Array.from(armed.querySelectorAll(".lab-optimize-more-summary")).map(
      (s) => s.textContent,
    );
    expect(summaries.some((t) => t?.includes("Power features"))).toBe(true);
    expect(armed.querySelector(".lab-optimize-power")).not.toBeNull();
    expect((armed.querySelector(".lab-optimize-power") as HTMLDetailsElement).open).toBe(false);
    cleanup();
    // Disarmed (default) → no Power-features bay at all.
    const off = renderMerged([SAFE_REC], false);
    expect(off.querySelector(".lab-optimize-power")).toBeNull();
  });

  it("the bench leads with the Optimize hero when tweaks exist and has NO Gallery bay (removed 2026-07-09)", () => {
    // Gallery (the drag telemetry trophy room) was deleted with the Instrument Bench redesign; the
    // bench is now the Optimize hero (when there are tweaks) + the 5 measure bays, nothing else.
    const withTweaks = renderMerged([SAFE_REC]);
    expect(withTweaks.querySelector(".lab-bench-hero-name")!.textContent).toBe("Optimize"); // hero leads
    expect(withTweaks.innerHTML).not.toContain("Gallery"); // gallery gone
    const measure = Array.from(withTweaks.querySelectorAll(".lab-bench-name")).map((n) => n.textContent);
    expect(measure[measure.length - 1]).toBe("Black Box"); // measure bays end here
    cleanup();
    const bare = renderMerged();
    expect(bare.querySelector(".lab-bench-hero")).toBeNull(); // no tweaks → no hero
    expect(bare.innerHTML).not.toContain("Gallery");
  });
});
