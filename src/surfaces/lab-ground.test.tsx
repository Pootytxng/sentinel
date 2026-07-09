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

describe("LabGround merged room composes both paths (incl. the empty/no-fixes state)", () => {
  // The self-reviewer couldn't exercise the empty path live (its rig had every fix applied) — so
  // this guard renders the merged room with recs=[] / nothing appliable and proves it degrades
  // cleanly: the fast-path + utility sections both mount, one idiom below, no crash.
  const renderMerged = (recs: never[] = []) =>
    render(
      <ConfirmProvider>
      <LabGround
        isAppliable={() => false}
        onOpenLibrary={() => {}}
        onChanged={() => {}}
        vendor="amd"
        recs={recs}
        startup={[]}
        changes={[]}
        busyId={null}
        activeChangeFor={() => undefined}
        onToggleRec={() => {}}
        onToggleStartup={() => {}}
        onRollback={() => {}}
        onApplyBatch={async () => ({ applied: 0, skipped: [] })}
        readiness={null}
        activeCount={0}
        diagnostics={<div data-testid="diag" />}
        diagnosticsCaptured
      />
      </ConfirmProvider>,
    ).container;

  it("empty state: fast path + utility spine both render, one idiom, no throw", () => {
    const c = renderMerged();
    // Fast path (the tweaks) and the utility (prove it yourself) both present.
    expect(c.querySelector(".lg-fast")).not.toBeNull();
    expect(c.querySelector(".lg-utility")).not.toBeNull();
    expect(c.querySelector(".lg-utility-kicker")).not.toBeNull();
    // The utility renders the ONE linear spine, not the retired idioms.
    expect(c.querySelector(".lab-router")).not.toBeNull();
    expect(c.querySelector(".lab-bento")).toBeNull();
    expect(c.querySelector(".lab-welcome")).toBeNull();
    // RoomShell verdict present (fixes-first, honest all-clear with zero appliable).
    expect(c.querySelector(".v2-room[data-room='lab']")).not.toBeNull();
  });
});
