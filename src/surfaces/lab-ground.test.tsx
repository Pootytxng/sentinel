import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
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
// LabGround's ground mode now always renders the Ops Console (LabConsole), whose center hologram
// lazily loads the ~600KB three.js bundle — stub it so this stays a fast DOM test (Task 4).
vi.mock("./rig/RigViewer", () => ({ RigViewer: () => <div data-testid="rig-hologram" /> }));

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

describe("LabGround OPS CONSOLE — LabConsole replaces the Instrument Bench bento (spec 2026-07-09, Task 4)", () => {
  // The Ops Console (Task 4) swaps the bento grid of station bays for a console room: a real
  // hologram + corner gauges, and a Dock of stations (Optimize primary, the measure/prove stations
  // beside it). These guards pin (a) the old seam classes stay GONE, (b) every station gets a dock
  // node regardless of whether tweaks exist (no crash on the empty-recs case), (c) Optimize opens
  // inline on click (it is NOT always-on), and (d) the RoomShell verdict + no-Gallery invariants
  // hold through the swap.
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

  const hw = {
    cpu_brand: "AMD Ryzen 7 9850X3D",
    cpu_cores_logical: 16,
    cpu_cores_physical: 8,
    ram_total_bytes: 32 * 1024 ** 3,
    gpus: [{ name: "AMD Radeon RX 9070 XT", vram_bytes: 16 * 1024 ** 3 }],
  } as never;

  const renderMerged = (recs: never[] = [], gamingEnabled = false) =>
    render(
      <ConfirmProvider>
      <LabGround
        hw={hw}
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

  it("the hologram + a dock node per station render; Optimize is primary; verdict present", () => {
    const c = renderMerged([SAFE_REC]);
    expect(c.querySelector('[data-testid="rig-hologram"]')).not.toBeNull();
    const nodeNames = Array.from(c.querySelectorAll(".dock-node .dock-nm")).map((n) => n.textContent);
    expect(nodeNames).toEqual(["Optimize", "Diagnostics", "Benchmark", "Latency", "Tuning", "Black Box"]);
    expect(c.querySelector(".dock-node-primary")!.textContent).toContain("Optimize");
    // One idiom: the retired linear-spine + bento + gallery faces stay absent.
    expect(c.querySelector(".lab-router")).toBeNull();
    expect(c.querySelector(".lab-bento")).toBeNull();
    expect(c.querySelector(".lab-welcome")).toBeNull();
    expect(c.innerHTML).not.toContain("Gallery");
    // RoomShell verdict present.
    expect(c.querySelector(".v2-room[data-room='lab']")).not.toBeNull();
  });

  it("empty state (no recs): every dock node still renders, no throw, verdict present", () => {
    const c = renderMerged();
    const nodeNames = Array.from(c.querySelectorAll(".dock-node .dock-nm")).map((n) => n.textContent);
    expect(nodeNames).toEqual(["Optimize", "Diagnostics", "Benchmark", "Latency", "Tuning", "Black Box"]);
    expect(c.querySelector(".v2-room[data-room='lab']")).not.toBeNull();
  });

  it("Optimize is NOT always-on — its detail panel opens only when its dock node is clicked", () => {
    const c = renderMerged([SAFE_REC]);
    expect(c.querySelector(".lc-detail")).toBeNull();
    const optimizeNode = Array.from(c.querySelectorAll<HTMLButtonElement>(".dock-node")).find((b) =>
      b.textContent?.includes("Optimize"),
    )!;
    fireEvent.click(optimizeNode);
    expect(c.querySelector(".lc-detail")).not.toBeNull();
    expect(c.querySelector(".lc-detail-name")!.textContent).toBe("Optimize");
  });

  it("§5 Power-features bay shows in the opened Optimize panel ONLY when Gaming Mode is armed; stays collapsed (lazy-mounts)", () => {
    // Armed → the read-first Power-features disclosure is offered inside the opened Optimize panel
    // (Gaming Mode + service-suspend, provable in the Lab). Closed by default so Gaming Mode never
    // mounts/polls until opened.
    const armed = renderMerged([SAFE_REC], true);
    const optimizeNode = Array.from(armed.querySelectorAll<HTMLButtonElement>(".dock-node")).find((b) =>
      b.textContent?.includes("Optimize"),
    )!;
    fireEvent.click(optimizeNode);
    const summaries = Array.from(armed.querySelectorAll(".lab-optimize-more-summary")).map(
      (s) => s.textContent,
    );
    expect(summaries.some((t) => t?.includes("Power features"))).toBe(true);
    expect(armed.querySelector(".lab-optimize-power")).not.toBeNull();
    expect((armed.querySelector(".lab-optimize-power") as HTMLDetailsElement).open).toBe(false);
    cleanup();
    // Disarmed (default) → no Power-features bay at all, even with the panel open.
    const off = renderMerged([SAFE_REC], false);
    const offNode = Array.from(off.querySelectorAll<HTMLButtonElement>(".dock-node")).find((b) =>
      b.textContent?.includes("Optimize"),
    )!;
    fireEvent.click(offNode);
    expect(off.querySelector(".lab-optimize-power")).toBeNull();
  });
});
